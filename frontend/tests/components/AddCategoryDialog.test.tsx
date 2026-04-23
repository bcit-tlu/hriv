/**
 * Unit tests for the AddCategoryDialog component.
 *
 * Covers:
 * 1. Renders dialog title with correct level
 * 2. Clicking "Create" calls onAdd and onClose with trimmed label
 * 3. Pressing Enter calls onAdd and onClose with trimmed label
 * 4. Pressing Enter does not propagate the keydown event
 * 5. Empty input prevents submission via Create button (disabled)
 * 6. Empty input prevents submission via Enter key
 * 7. Clicking "Cancel" calls onClose without calling onAdd
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddCategoryDialog from '../../src/components/AddCategoryDialog'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDialog(props: Partial<Parameters<typeof AddCategoryDialog>[0]> = {}) {
  const onClose = props.onClose ?? vi.fn()
  const onAdd = props.onAdd ?? vi.fn()
  const result = render(
    <AddCategoryDialog
      open={true}
      onClose={onClose}
      onAdd={onAdd}
      currentDepth={props.currentDepth ?? 0}
    />,
  )
  return { ...result, onClose, onAdd }
}

function getCategoryInput() {
  return screen.getByLabelText('Category name')
}

function getCreateButton() {
  return screen.getByRole('button', { name: 'Create' })
}

function getCancelButton() {
  return screen.getByRole('button', { name: 'Cancel' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AddCategoryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- Rendering ---

  it('renders the dialog title with the correct level', () => {
    renderDialog({ currentDepth: 2 })
    expect(screen.getByText('New Category (Level 3)')).toBeInTheDocument()
  })

  // --- Create button ---

  it('calls onAdd and onClose when Create button is clicked', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderDialog()

    await user.type(getCategoryInput(), '  Histology  ')
    await user.click(getCreateButton())

    expect(onAdd).toHaveBeenCalledWith('Histology')
    expect(onClose).toHaveBeenCalled()
  })

  it('disables Create button when input is empty', () => {
    renderDialog()
    expect(getCreateButton()).toBeDisabled()
  })

  // --- Enter key ---

  it('calls onAdd and onClose when Enter is pressed', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderDialog()

    await user.type(getCategoryInput(), 'Pathology')
    await user.keyboard('{Enter}')

    expect(onAdd).toHaveBeenCalledWith('Pathology')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onAdd when Enter is pressed with empty input', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderDialog()

    getCategoryInput().focus()
    await user.keyboard('{Enter}')

    expect(onAdd).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('prevents Enter keydown event from propagating', async () => {
    const user = userEvent.setup()
    const outerKeyDown = vi.fn()
    const onAdd = vi.fn()
    const onClose = vi.fn()

    const { container } = render(
      <div onKeyDown={outerKeyDown}>
        <AddCategoryDialog
          open={true}
          onClose={onClose}
          onAdd={onAdd}
          currentDepth={0}
        />
      </div>,
    )

    const input = screen.getByLabelText('Category name')
    await user.type(input, 'Test')
    await user.keyboard('{Enter}')

    expect(onAdd).toHaveBeenCalledWith('Test')
    // The outer div should NOT receive the Enter keydown thanks to stopPropagation
    const enterEvents = outerKeyDown.mock.calls.filter(
      (call: [KeyboardEvent]) => call[0].key === 'Enter',
    )
    expect(enterEvents).toHaveLength(0)

    container.remove()
  })

  // --- Cancel ---

  it('calls onClose without onAdd when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const { onAdd, onClose } = renderDialog()

    await user.type(getCategoryInput(), 'Something')
    await user.click(getCancelButton())

    expect(onClose).toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
