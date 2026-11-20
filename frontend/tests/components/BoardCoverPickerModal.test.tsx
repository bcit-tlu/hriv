import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import BoardCoverPickerModal from '../../src/components/BoardCoverPickerModal'
import { BOARD_ITEMS } from '../../src/components/boardsFixtures'

const members = BOARD_ITEMS.slice(0, 2)
type Props = Parameters<typeof BoardCoverPickerModal>[0]

function renderPicker(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    markers: members,
    currentMarkerId: null,
    currentBlank: false,
    ...overrides,
  }
  const view = render(<BoardCoverPickerModal {...props} />)
  return { ...view, props }
}

const radioIn = (label: string) =>
  within(within(screen.getByRole('dialog')).getByText(label).closest('tr')!).getByRole('radio')

const save = () =>
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))

describe('BoardCoverPickerModal', () => {
  it('pre-selects Automatic and saves a picked member', () => {
    const { props } = renderPicker()
    expect(screen.getByText('Choose Cover Image')).toBeInTheDocument()
    expect(radioIn('Automatic')).toBeChecked()
    fireEvent.click(screen.getByText(members[1].title))
    save()
    expect(props.onSave).toHaveBeenCalledWith(members[1].id, false)
  })

  it('starts on the pinned member and saves it unchanged', () => {
    const { props } = renderPicker({ currentMarkerId: members[0].id })
    expect(radioIn(members[0].title)).toBeChecked()
    save()
    expect(props.onSave).toHaveBeenCalledWith(members[0].id, false)
  })

  it('pre-selects None on a blank cover and saves the blank flag', () => {
    const { props } = renderPicker({ currentBlank: true })
    expect(radioIn('None')).toBeChecked()
    save()
    expect(props.onSave).toHaveBeenCalledWith(null, true)
  })

  it('Automatic clears a pin', () => {
    const { props } = renderPicker({ currentMarkerId: members[0].id })
    fireEvent.click(screen.getByText('Automatic'))
    save()
    expect(props.onSave).toHaveBeenCalledWith(null, false)
  })

  it('Cancel closes without saving', () => {
    const { props } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onSave).not.toHaveBeenCalled()
  })

  it('explains an empty Board and still offers None and Automatic', () => {
    renderPicker({ markers: [] })
    expect(screen.getByText('No Markers available on this Board.')).toBeInTheDocument()
    expect(radioIn('None')).toBeInTheDocument()
    expect(radioIn('Automatic')).toBeChecked()
  })

  it('re-stages the current cover each time it opens with updated props', () => {
    const { props, rerender } = renderPicker({ open: false })
    rerender(<BoardCoverPickerModal {...props} open currentBlank />)
    expect(radioIn('None')).toBeChecked()
    fireEvent.click(screen.getByText(members[1].title))
    rerender(<BoardCoverPickerModal {...props} open={false} currentBlank />)
    rerender(<BoardCoverPickerModal {...props} open currentMarkerId={members[0].id} />)
    expect(radioIn(members[0].title)).toBeChecked()
    save()
    expect(props.onSave).toHaveBeenCalledWith(members[0].id, false)
  })
})
