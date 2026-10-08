import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import CollectionCoverPickerModal from '../../src/components/CollectionCoverPickerModal'
import { makeImage } from '../helpers/fixtures'

const members = [makeImage({ id: 11, name: 'Frontal' }), makeImage({ id: 12, name: 'Lateral' })]

describe('CollectionCoverPickerModal', () => {
  it('saves the picked member id', () => {
    const onSave = vi.fn()
    render(
      <CollectionCoverPickerModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        images={members}
        currentImageId={null}
      />,
    )
    const modal = screen.getByRole('dialog')
    expect(within(modal).getByText('Choose Cover Image')).toBeInTheDocument()
    fireEvent.click(within(modal).getByText('Lateral'))
    fireEvent.click(within(modal).getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(12)
  })

  it('starts on the pinned member and Clear restores the fallback', () => {
    const onSave = vi.fn()
    render(
      <CollectionCoverPickerModal
        open
        onClose={vi.fn()}
        onSave={onSave}
        images={members}
        currentImageId={11}
      />,
    )
    const modal = screen.getByRole('dialog')
    const pinnedRow = within(modal).getByText('Frontal').closest('tr')!
    expect(within(pinnedRow).getByRole('radio')).toBeChecked()
    fireEvent.click(within(modal).getByRole('button', { name: 'Clear' }))
    fireEvent.click(within(modal).getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('shows the empty state when the collection has no visible members', () => {
    render(
      <CollectionCoverPickerModal
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
        images={[]}
        currentImageId={null}
      />,
    )
    expect(screen.getByText('No images available in this collection.')).toBeInTheDocument()
  })

  it('Cancel closes without saving', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(
      <CollectionCoverPickerModal
        open
        onClose={onClose}
        onSave={onSave}
        images={members}
        currentImageId={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
})
