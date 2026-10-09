import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import CollectionCoverPickerModal from '../../src/components/CollectionCoverPickerModal'
import { makeImage } from '../helpers/fixtures'

const members = [makeImage({ id: 11, name: 'Frontal' }), makeImage({ id: 12, name: 'Lateral' })]

function renderPicker(overrides: Partial<Parameters<typeof CollectionCoverPickerModal>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    images: members,
    currentImageId: null,
    currentBlank: false,
    ...overrides,
  }
  render(<CollectionCoverPickerModal {...props} />)
  return props
}

describe('CollectionCoverPickerModal', () => {
  it('saves the picked member id and clears the blank flag', () => {
    const props = renderPicker()
    const modal = screen.getByRole('dialog')
    expect(within(modal).getByText('Choose Cover Image')).toBeInTheDocument()
    fireEvent.click(within(modal).getByText('Lateral'))
    fireEvent.click(within(modal).getByRole('button', { name: 'Save' }))
    expect(props.onSave).toHaveBeenCalledWith(12, false)
  })

  it('starts on the pinned member and Automatic restores the fallback', () => {
    const props = renderPicker({ currentImageId: 11 })
    const modal = screen.getByRole('dialog')
    const pinnedRow = within(modal).getByText('Frontal').closest('tr')!
    expect(within(pinnedRow).getByRole('radio')).toBeChecked()
    fireEvent.click(within(modal).getByText('Automatic'))
    fireEvent.click(within(modal).getByRole('button', { name: 'Save' }))
    expect(props.onSave).toHaveBeenCalledWith(null, false)
  })

  it('pre-selects Automatic when no cover is pinned', () => {
    renderPicker()
    const modal = screen.getByRole('dialog')
    const autoRow = within(modal).getByText('Automatic').closest('tr')!
    expect(within(autoRow).getByRole('radio')).toBeChecked()
  })

  it('pre-selects None on a blank cover and saves the blank flag', () => {
    const props = renderPicker({ currentBlank: true })
    const modal = screen.getByRole('dialog')
    const noneRow = within(modal).getByText('None').closest('tr')!
    expect(within(noneRow).getByRole('radio')).toBeChecked()
    fireEvent.click(within(modal).getByRole('button', { name: 'Save' }))
    expect(props.onSave).toHaveBeenCalledWith(null, true)
  })

  it('picking None then a member saves the member with no blank flag', () => {
    const props = renderPicker({ currentBlank: true })
    const modal = screen.getByRole('dialog')
    fireEvent.click(within(modal).getByText('Frontal'))
    fireEvent.click(within(modal).getByRole('button', { name: 'Save' }))
    expect(props.onSave).toHaveBeenCalledWith(11, false)
  })

  it('shows the empty state when the collection has no visible members', () => {
    renderPicker({ images: [] })
    expect(screen.getByText('No images available in this collection.')).toBeInTheDocument()
  })

  it('keeps the state options selectable when the collection is empty', () => {
    const props = renderPicker({ images: [] })
    const modal = screen.getByRole('dialog')
    fireEvent.click(within(modal).getByText('None'))
    fireEvent.click(within(modal).getByRole('button', { name: 'Save' }))
    expect(props.onSave).toHaveBeenCalledWith(null, true)
  })

  it('Cancel closes without saving', () => {
    const props = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onSave).not.toHaveBeenCalled()
  })
})
