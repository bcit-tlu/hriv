import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ImageInfoAccordion, {
  type ImageInfoAccordionProps,
} from '../../src/components/ImageInfoAccordion'

const originalInnerHeight = window.innerHeight
const originalMatchMedia = window.matchMedia
const originalScrollBy = window.scrollBy
const scrollByMock = vi.fn()

function makeRect(top: number, bottom: number, left: number, right: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 250 })
  window.scrollBy = scrollByMock
  scrollByMock.mockReset()
  window.matchMedia = vi.fn(() => ({
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
})

afterEach(() => {
  window.scrollBy = originalScrollBy
  window.matchMedia = originalMatchMedia
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: originalInnerHeight,
  })
})

function expectFieldToContain(label: string, value: string) {
  const field = screen.getByText(label, { exact: true }).parentElement
  expect(field).toHaveTextContent(`${label} ${value}`)
}

function makeProps(overrides: Partial<ImageInfoAccordionProps> = {}): ImageInfoAccordionProps {
  return {
    image: { id: 7 },
    programNames: [],
    groupNames: [],
    expanded: true,
    onExpandedChange: vi.fn(),
    ...overrides,
  }
}

describe('ImageInfoAccordion', () => {
  it('renders collapsed and reports expansion changes', () => {
    const props = makeProps({ expanded: false })
    render(<ImageInfoAccordion {...props} />)

    const summary = screen.getByRole('button', { name: 'Image information' })
    expect(summary).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(summary)

    expect(props.onExpandedChange).toHaveBeenCalledWith(true)
  })

  it('scrolls for the expanded details height before reporting expansion', () => {
    const callOrder: string[] = []
    const onExpandedChange = vi.fn(() => callOrder.push('expand'))
    const props = makeProps({ expanded: false, onExpandedChange })
    const { container } = render(<ImageInfoAccordion {...props} />)
    const accordion = container.querySelector('.MuiAccordion-root') as HTMLElement
    const details = container.querySelector('.MuiAccordionDetails-root') as HTMLElement
    Object.defineProperty(details, 'offsetHeight', { configurable: true, value: 100 })
    vi.spyOn(accordion, 'getBoundingClientRect').mockReturnValue(makeRect(100, 200, 0, 300))
    scrollByMock.mockImplementation(() => callOrder.push('scroll'))

    fireEvent.click(screen.getByRole('button', { name: 'Image information' }))

    expect(scrollByMock).toHaveBeenCalledWith({ top: 66, behavior: 'smooth' })
    expect(onExpandedChange).toHaveBeenCalledWith(true)
    expect(callOrder).toEqual(['scroll', 'expand'])
  })

  it('does not scroll when the accordion collapses', () => {
    const props = makeProps({ expanded: true })
    render(<ImageInfoAccordion {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Image information' }))

    expect(props.onExpandedChange).toHaveBeenCalledWith(false)
    expect(scrollByMock).not.toHaveBeenCalled()
  })

  it('does not scroll when initially mounted with persisted expansion', async () => {
    render(<ImageInfoAccordion {...makeProps({ expanded: true })} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(scrollByMock).not.toHaveBeenCalled()
  })

  it('shows each populated image information field and the viewer hint', () => {
    render(
      <ImageInfoAccordion
        {...makeProps({
          image: {
            id: 7,
            copyright: '© Museum archive',
            note: 'First line\nSecond line\nThird line',
            createdAt: '2025-01-02T03:04:05Z',
            updatedAt: '2025-02-03T04:05:06Z',
            width: 2400,
            height: 1600,
            fileSize: 1536,
          },
          programNames: ['Fine Art', 'History'],
          groupNames: ['Curators'],
          measurement: { scale: 4, unit: 'mm' },
          sourceInfo: {
            originalFilename: 'duomo-scan.tif',
            fileType: 'TIF',
            uploadedByName: 'Mira Patel',
          },
        })}
      />,
    )

    expectFieldToContain('Copyright:', '© Museum archive')
    expectFieldToContain('Programs:', 'Fine Art, History')
    expectFieldToContain('Group:', 'Curators')
    expect(screen.getByText(/Note:/)).toBeInTheDocument()
    expect(screen.getByText(/First line\s+Second line\s+Third line/)).toBeInTheDocument()
    expect(screen.getByText(/Created:/)).toBeInTheDocument()
    expect(screen.getByText(/Modified:/)).toBeInTheDocument()
    expectFieldToContain('Dimensions:', '2400 × 1600')
    expectFieldToContain('Size:', '1.5 KB')
    expectFieldToContain('Measurement:', '4 px/mm')
    expectFieldToContain('Original file:', 'duomo-scan.tif')
    expectFieldToContain('File type:', 'TIF')
    expectFieldToContain('Uploaded by:', 'Mira Patel')
    expect(screen.getByText(/Scroll or tap to zoom, and drag to pan/)).toBeInTheDocument()
  })

  it('omits fields with null or empty values', () => {
    render(
      <ImageInfoAccordion
        {...makeProps({
          image: {
            id: 7,
            copyright: '',
            note: '',
            createdAt: null,
            updatedAt: null,
            width: null,
            height: null,
            fileSize: null,
          },
          measurement: null,
        })}
      />,
    )

    for (const label of [
      'Copyright:',
      'Program:',
      'Programs:',
      'Group:',
      'Groups:',
      'Note:',
      'Created:',
      'Modified:',
      'Dimensions:',
      'Size:',
      'Measurement:',
      'Original file:',
      'File type:',
      'Uploaded by:',
    ]) {
      expect(screen.queryByText(label, { exact: false })).not.toBeInTheDocument()
    }
    expect(screen.getByText(/Scroll or tap to zoom/)).toBeInTheDocument()
  })

  it('renders partial source information and omits empty source fields', () => {
    const { rerender } = render(
      <ImageInfoAccordion
        {...makeProps({
          sourceInfo: {
            originalFilename: 'scan.tif',
            fileType: null,
            uploadedByName: null,
          },
        })}
      />,
    )

    expectFieldToContain('Original file:', 'scan.tif')
    expect(screen.queryByText('File type:', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Uploaded by:', { exact: true })).not.toBeInTheDocument()

    rerender(
      <ImageInfoAccordion
        {...makeProps({
          sourceInfo: {
            originalFilename: null,
            fileType: null,
            uploadedByName: null,
          },
        })}
      />,
    )
    expect(screen.queryByText('Original file:', { exact: true })).not.toBeInTheDocument()
  })

  it('uses singular and plural program labels', () => {
    const { rerender } = render(<ImageInfoAccordion {...makeProps({ programNames: ['Art'] })} />)

    expectFieldToContain('Program:', 'Art')

    rerender(<ImageInfoAccordion {...makeProps({ programNames: ['Art', 'History'] })} />)

    expectFieldToContain('Programs:', 'Art, History')
  })

  it('renders collections after groups and keeps the classification row when collections are the only field', () => {
    const collections = <span data-testid="collections-slot">Collections: Photo archive</span>
    const { rerender } = render(
      <ImageInfoAccordion
        {...makeProps({
          groupNames: ['Curators'],
          collections,
        })}
      />,
    )

    const groupLabel = screen.getByText('Group:', { exact: true })
    const collectionsNode = screen.getByTestId('collections-slot')
    const classificationRow = collectionsNode.closest('.MuiBox-root')
    expect(classificationRow).not.toBeNull()
    expect(classificationRow).toHaveTextContent('Group: CuratorsCollections: Photo archive')
    expect(
      groupLabel.compareDocumentPosition(collectionsNode) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    rerender(<ImageInfoAccordion {...makeProps({ collections })} />)

    const collectionsOnlyNode = screen.getByTestId('collections-slot')
    const collectionsOnlyRow = collectionsOnlyNode.closest('.MuiBox-root')
    expect(collectionsOnlyRow).not.toBeNull()
    expect(collectionsOnlyRow).toHaveTextContent('Collections: Photo archive')
  })

  it.each([
    [{ scale: 4, unit: 'mm' }, 'Measurement: 4 px/mm'],
    [{ scale: 4 }, 'Measurement: 4 px'],
    [{ unit: 'mm' }, 'Measurement: mm'],
  ])('formats measurement config %#', (measurement, expected) => {
    render(<ImageInfoAccordion {...makeProps({ measurement })} />)

    expectFieldToContain('Measurement:', expected.replace('Measurement: ', ''))
  })
})
