import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkEditCollectionsDialog from '../../src/components/BulkEditCollectionsDialog'
import { makeCategory } from '../helpers/fixtures'

const CATEGORIES = [
  makeCategory({ id: 10, label: 'Anatomy' }),
  makeCategory({ id: 11, label: 'Histology' }),
]

type Props = Parameters<typeof BulkEditCollectionsDialog>[0]

function renderDialog(overrides: Partial<Props> = {}) {
  const onClose = overrides.onClose ?? vi.fn()
  const onSave = overrides.onSave ?? vi.fn()
  const onDelete = overrides.onDelete ?? vi.fn()
  const result = render(
    <BulkEditCollectionsDialog
      open={overrides.open ?? true}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
      categories={overrides.categories ?? CATEGORIES}
      selectedCount={overrides.selectedCount ?? 3}
      privateSelectedCount={overrides.privateSelectedCount}
      canCurate={overrides.canCurate ?? true}
      canDeleteAll={overrides.canDeleteAll ?? true}
      allCategoryHidden={overrides.allCategoryHidden ?? false}
      programs={overrides.programs ?? []}
      groups={overrides.groups ?? []}
    />,
  )
  return { ...result, onClose, onSave, onDelete }
}

describe('BulkEditCollectionsDialog (#1578)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends only the fields the user changed', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDialog({ onSave })

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({}))
  })

  it('sends category_id when the picker changes', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDialog({ onSave })

    await user.click(screen.getByRole('combobox'))
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /^Histology/ }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ category_id: 11 }))
  })

  it('can unfile with the Not on Browse option', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDialog({ onSave })

    await user.click(screen.getByRole('combobox'))
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /Not on Browse/ }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ category_id: null }))
  })

  it('warns when selected private collections are filed into a category', async () => {
    const user = userEvent.setup()
    renderDialog({ privateSelectedCount: 2 })

    await user.click(screen.getByRole('combobox'))
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /^Histology/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '2 of the 3 selected collections are private. Filed on Browse, their tiles are visible only to their owners and to staff, instructors and admins — not to other students.',
    )
  })

  it('hides the bulk warning for public selections or an unfiled destination', async () => {
    const user = userEvent.setup()
    const { rerender } = renderDialog({ privateSelectedCount: 0 })

    await user.click(screen.getByRole('combobox'))
    let listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /^Histology/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    rerender(
      <BulkEditCollectionsDialog
        open
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        categories={CATEGORIES}
        selectedCount={3}
        privateSelectedCount={2}
        canCurate
        canDeleteAll
      />,
    )
    await user.click(screen.getByRole('combobox'))
    listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /^Histology/ }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox'))
    listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /Not on Browse/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('maps the visibility switch to hidden when toggled off', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDialog({ onSave })

    await user.click(screen.getByRole('switch', { name: /visible to students/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ hidden: true }))
  })

  it('disables the visibility switch when every selection is category-hidden', () => {
    // BulkEditImagesModal's `allCategoryHidden` convention — the switch
    // can't change what the hidden category already hides.
    renderDialog({ allCategoryHidden: true })
    expect(screen.getByRole('switch', { name: /hidden by category/i })).toBeDisabled()
  })

  it('disables the visibility switch when the chosen category is hidden', async () => {
    const user = userEvent.setup()
    renderDialog({
      categories: [
        makeCategory({ id: 10, label: 'Anatomy', status: 'hidden' }),
        makeCategory({ id: 11, label: 'Histology' }),
      ],
    })

    await user.click(screen.getByRole('combobox'))
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /^Anatomy/ }))
    expect(screen.getByRole('switch', { name: /hidden by category/i })).toBeDisabled()
  })

  it('drops a pending visibility toggle when the chosen category is hidden', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderDialog({
      onSave,
      categories: [
        makeCategory({ id: 10, label: 'Anatomy', status: 'hidden' }),
        makeCategory({ id: 11, label: 'Histology' }),
      ],
    })

    await user.click(screen.getByRole('switch', { name: /visible to students/i }))
    await user.click(screen.getByRole('combobox'))
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: /^Anatomy/ }))
    expect(screen.getByRole('switch', { name: /hidden by category/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    // The locked switch's earlier toggle must not leak — only the refile.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ category_id: 10 }))
  })

  it('requires two clicks to delete and calls onDelete', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderDialog({ onDelete })

    await user.click(screen.getByRole('button', { name: /delete 3 selected collections/i }))
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /confirm delete 3 collections/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
  })

  it('disables delete when any selected row is not deletable', async () => {
    renderDialog({ canDeleteAll: false })
    expect(screen.getByRole('button', { name: /delete 3 selected collections/i })).toBeDisabled()
  })

  it('hides curator fields and Save for non-curators', () => {
    renderDialog({ canCurate: false })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /visible to students/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete 3 selected collections/i })).toBeEnabled()
  })

  it('shows an error toast when bulk delete fails', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockRejectedValue(new Error('Server error'))
    renderDialog({ onDelete })

    await user.click(screen.getByRole('button', { name: /delete 3 selected collections/i }))
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))
    await waitFor(() => {
      expect(
        screen.getByText('Failed to delete collections. Please try again.'),
      ).toBeInTheDocument()
    })
  })

  it('shows an error toast when bulk save fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('Server error'))
    renderDialog({ onSave })

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => {
      expect(screen.getByText('Failed to save changes. Please try again.')).toBeInTheDocument()
    })
  })
})
