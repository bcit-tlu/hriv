import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ImageInfoAccordion, {
  type ImageInfoAccordionProps,
} from '../../src/components/ImageInfoAccordion'

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

  it.each([
    [{ scale: 4, unit: 'mm' }, 'Measurement: 4 px/mm'],
    [{ scale: 4 }, 'Measurement: 4 px'],
    [{ unit: 'mm' }, 'Measurement: mm'],
  ])('formats measurement config %#', (measurement, expected) => {
    render(<ImageInfoAccordion {...makeProps({ measurement })} />)

    expectFieldToContain('Measurement:', expected.replace('Measurement: ', ''))
  })
})
