import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import ImageDetailsDrawer, {
  type ImageDetailsDrawerProps,
} from '../../src/components/ImageDetailsDrawer'

function makeProps(
  overrides: Partial<ImageDetailsDrawerProps> = {},
): Omit<ImageDetailsDrawerProps, 'open' | 'onOpenChange'> {
  return {
    image: {},
    programNames: [],
    groupNames: [],
    ...overrides,
  }
}

function Harness(props: Omit<ImageDetailsDrawerProps, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <ImageDetailsDrawer {...props} open={open} onOpenChange={setOpen} />
    </div>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Image details' })

const populatedProps = makeProps({
  image: {
    copyright: '© Museum archive',
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
})

function expectField(label: string, value: string) {
  const field = screen.getByText(label, { exact: true }).parentElement as HTMLElement
  expect(field).toHaveTextContent(`${label} ${value}`)
  expect(field).toHaveAttribute('title', `${label} ${value}`)
}

describe('ImageDetailsDrawer', () => {
  it('renders a labelled trigger with the panel absent while closed', () => {
    render(<Harness {...makeProps()} />)

    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveAttribute('aria-controls', 'image-details-drawer')
    expect(screen.queryByRole('heading', { name: 'Image details' })).not.toBeInTheDocument()
  })

  it('opens the panel on trigger click and focuses the close button', async () => {
    render(<Harness {...makeProps()} />)

    fireEvent.click(trigger())

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('heading', { name: 'Image details' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close image details' })).toHaveFocus()
    })
  })

  it('shows each populated field with the full value in title', async () => {
    render(<Harness {...populatedProps} />)
    fireEvent.click(trigger())

    await screen.findByRole('heading', { name: 'Image details' })
    expectField('Copyright:', '© Museum archive')
    expectField('Programs:', 'Fine Art, History')
    expectField('Group:', 'Curators')
    for (const [label, iso] of [
      ['Created:', populatedProps.image.createdAt],
      ['Modified:', populatedProps.image.updatedAt],
    ] as const) {
      const field = screen.getByText(label, { exact: true }).parentElement as HTMLElement
      expect(field).toHaveTextContent(
        `${label} ${new Date(iso as string).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
      )
      expect(field).toHaveAttribute('title', `${label} ${new Date(iso as string).toLocaleString()}`)
    }
    expectField('Dimensions:', '2400 × 1600')
    expectField('Size:', '1.5 KB')
    expectField('Measurement:', '4 px/mm')
    expectField('Original file:', 'duomo-scan.tif')
    expectField('File type:', 'TIF')
    expectField('Uploaded by:', 'Mira Patel')
  })

  it('omits empty fields and shows the empty state when nothing is populated', async () => {
    render(
      <Harness
        {...makeProps({
          image: {
            copyright: '',
            createdAt: null,
            updatedAt: null,
            width: null,
            height: null,
            fileSize: null,
          },
          measurement: null,
          sourceInfo: null,
        })}
      />,
    )
    fireEvent.click(trigger())
    await screen.findByRole('heading', { name: 'Image details' })

    for (const label of [
      'Copyright:',
      'Program:',
      'Programs:',
      'Group:',
      'Groups:',
      'Created:',
      'Modified:',
      'Dimensions:',
      'Size:',
      'Measurement:',
      'Original file:',
      'File type:',
      'Uploaded by:',
    ]) {
      expect(screen.queryByText(label, { exact: true })).not.toBeInTheDocument()
    }
    expect(screen.getByText('No details available.')).toBeInTheDocument()
  })

  it('uses singular and plural program labels', async () => {
    const { rerender } = render(
      <div style={{ position: 'relative' }}>
        <ImageDetailsDrawer
          {...makeProps({ programNames: ['Art'] })}
          open
          onOpenChange={() => {}}
        />
      </div>,
    )

    await screen.findByRole('heading', { name: 'Image details' })
    expectField('Program:', 'Art')

    rerender(
      <div style={{ position: 'relative' }}>
        <ImageDetailsDrawer
          {...makeProps({ programNames: ['Art', 'History'] })}
          open
          onOpenChange={() => {}}
        />
      </div>,
    )
    expectField('Programs:', 'Art, History')
  })

  it.each([
    [{ scale: 4, unit: 'mm' }, '4 px/mm'],
    [{ scale: 4 }, '4 px'],
    [{ unit: 'mm' }, 'mm'],
  ])('formats measurement config %#', async (measurement, expected) => {
    render(<Harness {...makeProps({ measurement })} />)
    fireEvent.click(trigger())
    await screen.findByRole('heading', { name: 'Image details' })

    expectField('Measurement:', expected)
  })

  it('does not contain notes or collections; instructions live in the footer', async () => {
    render(<Harness {...populatedProps} />)
    fireEvent.click(trigger())
    await screen.findByRole('heading', { name: 'Image details' })

    const panel = document.getElementById('image-details-drawer') as HTMLElement
    expect(panel).not.toHaveTextContent('Note:')
    expect(panel).not.toHaveTextContent('Collections:')
    const list = within(screen.getByRole('region', { name: 'Viewer controls' })).getByRole('list')
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Scroll or tap to zoom',
      'Drag to move/pan',
      'Bottom left buttons control view',
      'Bottom right mini-map shows current view',
    ])
  })

  it('pins the instructions footer outside the scrolling field list', async () => {
    render(<Harness {...populatedProps} />)
    fireEvent.click(trigger())
    await screen.findByRole('heading', { name: 'Image details' })

    const instructions = screen.getByText(/Scroll or tap to zoom/)
    const field = screen.getByText('Copyright:', { exact: true }).parentElement as HTMLElement
    const scrollRegion = field.parentElement?.parentElement as HTMLElement
    expect(scrollRegion).toContainElement(field)
    expect(scrollRegion).not.toContainElement(instructions)

    // The footer is its own labelled, scrollable region (short viewports).
    const region = screen.getByRole('region', { name: 'Viewer controls' })
    expect(region).toHaveStyle({ overflowY: 'auto' })
    expect(region).toContainElement(instructions)
    expect(within(region).getByRole('heading', { name: 'Viewer controls' })).toBeInTheDocument()
    expect(scrollRegion).not.toContainElement(region)
  })

  it('closes via the ✕ button and returns focus to the trigger', async () => {
    render(<Harness {...makeProps()} />)
    fireEvent.click(trigger())
    const closeButton = await screen.findByRole('button', { name: 'Close image details' })

    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Image details' })).not.toBeInTheDocument()
    })
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveFocus()
  })

  it('closes on Escape inside the panel', async () => {
    render(<Harness {...makeProps()} />)
    fireEvent.click(trigger())
    const panel = await screen.findByRole('heading', { name: 'Image details' })
    fireEvent.keyDown(panel.closest('[id="image-details-drawer"]') as HTMLElement, {
      key: 'Escape',
    })

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Image details' })).not.toBeInTheDocument()
    })
    expect(trigger()).toHaveFocus()
  })

  it('closes when the trigger is clicked again', async () => {
    render(<Harness {...makeProps()} />)
    fireEvent.click(trigger())
    await screen.findByRole('heading', { name: 'Image details' })

    fireEvent.click(trigger())

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Image details' })).not.toBeInTheDocument()
    })
  })

  it('disables the trigger when disabled', () => {
    render(<Harness {...makeProps({ disabled: true })} />)
    expect(trigger()).toBeDisabled()
  })

  it('marks trigger and panel with data-hriv-canvas-ui', async () => {
    render(<Harness {...makeProps()} />)
    expect(trigger()).toHaveAttribute('data-hriv-canvas-ui')

    fireEvent.click(trigger())
    const panel = document.getElementById('image-details-drawer')
    expect(panel).toHaveAttribute('data-hriv-canvas-ui')
  })
})
