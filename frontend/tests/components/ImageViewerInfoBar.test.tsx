import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ImageViewerInfoBar from '../../src/components/ImageViewerInfoBar'
import ImageCollectionsList from '../../src/components/ImageCollectionsList'

const collections = (names: string[]) => (
  <ImageCollectionsList
    collections={names.map((name, i) => ({ id: i + 1, name }))}
    onOpenCollection={() => {}}
  />
)

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

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

afterEach(() => {
  for (const [prop, descriptor] of [
    ['scrollHeight', originalScrollHeight],
    ['clientHeight', originalClientHeight],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, prop, descriptor)
    } else {
      // Not an own property on HTMLElement.prototype: remove the stub so
      // the inherited jsdom getter applies again.
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
  }
})

describe('ImageViewerInfoBar', () => {
  it('renders the note and collections cells without the viewer instructions', () => {
    render(
      <ImageViewerInfoBar
        imageId={7}
        note="Handle with care"
        collections={collections(['Skull comparison'])}
      />,
    )

    expect(screen.getByText('Note:', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Handle with care')).toBeInTheDocument()
    expect(screen.getByText('Collections:', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skull comparison' })).toBeInTheDocument()
    expect(screen.queryByText(/Scroll or tap to zoom/)).not.toBeInTheDocument()
  })

  it('renders a single cell when only one kind of content is present', () => {
    const { rerender } = render(<ImageViewerInfoBar imageId={7} note="A note" />)
    expect(screen.getByText('Note:', { exact: true })).toBeInTheDocument()
    expect(screen.queryByText('Collections:', { exact: true })).not.toBeInTheDocument()

    rerender(<ImageViewerInfoBar imageId={7} collections={collections(['One'])} />)
    expect(screen.queryByText('Note:', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText('Collections:', { exact: true })).toBeInTheDocument()
  })

  it('renders nothing when neither note nor collections are present', () => {
    const { container } = render(<ImageViewerInfoBar imageId={7} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the label and value as siblings in a flex row', () => {
    render(
      <ImageViewerInfoBar
        imageId={7}
        note="A note"
        collections={<span data-testid="collections-slot">links</span>}
      />,
    )

    for (const [label, value] of [
      ['Note:', screen.getByText('A note')],
      ['Collections:', screen.getByTestId('collections-slot')],
    ] as const) {
      const labelEl = screen.getByText(label, { exact: true })
      // labelEl is the <strong>; its parent is the label Typography and the
      // label column's flex box is the grandparent.
      const labelColumn = labelEl.parentElement?.parentElement as HTMLElement
      const row = labelColumn.parentElement as HTMLElement
      expect(row).toContainElement(value)
      expect(labelColumn).toContainElement(labelEl)
      expect(labelEl).not.toContainElement(value)
    }
  })

  it('shows an inline "more" link that opens a popover with the full note', async () => {
    stubOverflow()
    const note = 'First line\nSecond line\nThird line\nFourth line'
    render(<ImageViewerInfoBar imageId={7} note={note} />)

    const showMore = screen.getByRole('button', { name: 'Show full note' })
    expect(showMore).toHaveAttribute('aria-haspopup', 'dialog')
    expect(showMore).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(showMore)

    const popover = screen.getByRole('presentation')
    expect(showMore).toHaveAttribute('aria-expanded', 'true')
    expect(within(popover).getByText('Note')).toBeInTheDocument()
    expect(within(popover).getByText(/First line/)).toBeInTheDocument()

    fireEvent.keyDown(popover, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText('Note', { selector: 'h3' })).not.toBeInTheDocument()
    })
  })

  it('lists every collection link inside the popover', () => {
    stubOverflow()
    const items = [
      { id: 1, name: 'One' },
      { id: 2, name: 'Two' },
      { id: 3, name: 'Three' },
      { id: 4, name: 'Four' },
    ]
    render(
      <ImageViewerInfoBar
        imageId={7}
        collections={
          <ImageCollectionsList
            collections={items}
            limit={items.length}
            onOpenCollection={() => {}}
          />
        }
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show all collections' }))
    const popover = screen.getByRole('presentation')
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      expect(within(popover).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('does not render the more affordance without overflow', () => {
    render(<ImageViewerInfoBar imageId={7} note="Short" collections={collections(['One'])} />)
    expect(screen.queryByRole('button', { name: 'Show full note' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show all collections' })).not.toBeInTheDocument()
  })
})
