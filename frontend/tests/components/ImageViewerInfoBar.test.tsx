import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ImageViewerInfoBar from '../../src/components/ImageViewerInfoBar'
import type { ImageCollectionsListItem } from '../../src/components/ImageCollectionsList'

const collections = (names: string[]): ImageCollectionsListItem[] =>
  names.map((name, i) => ({ id: i + 1, name }))

const defaultProps = {
  imageId: 7,
  name: 'Skull — frontal',
  active: true,
  collections: [] as ImageCollectionsListItem[],
  onOpenCollection: vi.fn(),
  onShowNote: vi.fn(),
  onShowCollections: vi.fn(),
}

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getBoundingClientRect',
)

function stubOverflow() {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 100,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 40,
  })
}

/**
 * Fake the FittedCollections measurements: the cell is `available` px wide,
 * the "Collections:" label sample is 60, every "name + separator" span is
 * `nameWidth`, and the suffix sample is 60.
 */
function stubFitWidths(available: number, nameWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return available
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      const text = this.textContent ?? ''
      let width = nameWidth
      if (text === 'Collections:') width = 60
      else if (text.startsWith(' … + ')) width = 60
      return { left: 0, top: 0, right: width, bottom: 20, width, height: 20 } as DOMRect
    },
  })
}

afterEach(() => {
  vi.clearAllMocks()
  for (const [prop, descriptor] of [
    ['scrollHeight', originalScrollHeight],
    ['clientHeight', originalClientHeight],
    ['clientWidth', originalClientWidth],
    ['getBoundingClientRect', originalGetBoundingClientRect],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, prop, descriptor)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
  }
})

describe('ImageViewerInfoBar', () => {
  it('always renders the title h2, even with no note and no collections', () => {
    render(<ImageViewerInfoBar {...defaultProps} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Skull — frontal' })).toBeInTheDocument()
    expect(screen.queryByText('Collections:', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Notes:', { exact: true })).not.toBeInTheDocument()
  })

  it('shows the Notes label and flattened note, and "…more" calls onShowNote', () => {
    stubOverflow()
    const onShowNote = vi.fn()
    render(
      <ImageViewerInfoBar
        {...defaultProps}
        note={'First line\nSecond line'}
        onShowNote={onShowNote}
      />,
    )

    expect(screen.getByText('Notes:', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('First line Second line')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show full note' }))
    expect(onShowNote).toHaveBeenCalledTimes(1)
  })

  it('does not render the note affordance without overflow', () => {
    render(<ImageViewerInfoBar {...defaultProps} note="Short" />)
    expect(screen.queryByRole('button', { name: 'Show full note' })).not.toBeInTheDocument()
  })

  it('renders collection links and hides overflow behind "+ N more"', () => {
    // 60 label + 2 names(40 each) + 60 suffix = 200 = cell width → k = 2 of 5.
    stubFitWidths(200, 40)
    const onShowCollections = vi.fn()
    const onOpenCollection = vi.fn()
    render(
      <ImageViewerInfoBar
        {...defaultProps}
        collections={collections(['One', 'Two', 'Three', 'Four', 'Five'])}
        onOpenCollection={onOpenCollection}
        onShowCollections={onShowCollections}
      />,
    )

    // The visible label is a Typography span; the aria-hidden clone's plain
    // span shares the text, so select the styled one.
    expect(
      screen.getByText('Collections:', { selector: 'span.MuiTypography-root' }),
    ).toBeInTheDocument()
    for (const name of ['One', 'Two']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    for (const name of ['Three', 'Four', 'Five']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }

    const more = screen.getByRole('button', { name: 'Show all 5 collections' })
    expect(more).toHaveTextContent('+ 3 more')
    fireEvent.click(more)
    expect(onShowCollections).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'One' }))
    expect(onOpenCollection).toHaveBeenCalledWith(1)
  })

  it('shows all names when they fit', () => {
    stubFitWidths(1000, 40)
    render(<ImageViewerInfoBar {...defaultProps} collections={collections(['One', 'Two'])} />)
    expect(screen.getByRole('button', { name: 'One' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Two' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Show all .* collections/ }),
    ).not.toBeInTheDocument()
  })
})
