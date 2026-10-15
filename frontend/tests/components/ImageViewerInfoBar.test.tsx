import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageViewerInfoBar from '../../src/components/ImageViewerInfoBar'
import ImageCollectionsList from '../../src/components/ImageCollectionsList'

const INSTRUCTIONS =
  'Scroll or tap to zoom, and drag to move/pan. Buttons in the bottom left control the view. The mini-map in the bottom-right shows your current view.'

describe('ImageViewerInfoBar', () => {
  it('renders the note, collections slot and instructions', () => {
    render(
      <ImageViewerInfoBar
        imageId={7}
        note="Handle with care"
        collections={
          <ImageCollectionsList
            collections={[{ id: 3, name: 'Skull comparison' }]}
            onOpenCollection={() => {}}
          />
        }
      />,
    )

    expect(screen.getByText('Note:', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Handle with care')).toBeInTheDocument()
    expect(screen.getByText('Collections:', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skull comparison' })).toBeInTheDocument()
    expect(screen.getByText(INSTRUCTIONS)).toBeInTheDocument()
  })

  it('hides the empty Note/Collections labels but keeps the instructions', () => {
    render(<ImageViewerInfoBar imageId={7} />)

    expect(screen.queryByText('Note:', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Collections:', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText(INSTRUCTIONS)).toBeInTheDocument()
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
      // grandparent is the flex row that also wraps the value box.
      const row = labelEl.parentElement?.parentElement as HTMLElement
      expect(row).toContainElement(value)
      // The value is a sibling of the label's Typography, not nested inside it.
      expect(labelEl).not.toContainElement(value)
    }
  })

  it('resets the Show more state when imageId changes', async () => {
    const user = userEvent.setup()
    const longNote = 'A'.repeat(400)
    const { rerender } = render(<ImageViewerInfoBar imageId={7} note={longNote} />)

    await user.click(screen.getByRole('button', { name: /Show more/i }))
    expect(screen.getByRole('button', { name: /Show less/i })).toBeInTheDocument()

    rerender(<ImageViewerInfoBar imageId={8} note={longNote} />)

    expect(screen.queryByRole('button', { name: /Show less/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show more/i })).toBeInTheDocument()
  })
})
