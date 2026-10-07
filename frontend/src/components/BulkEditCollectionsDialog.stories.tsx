import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Category } from '../types'
import BulkEditCollectionsDialog from './BulkEditCollectionsDialog'

function makeCategory(
  id: number,
  label: string,
  parentId: number | null = null,
  children: Category[] = [],
): Category {
  return {
    id,
    label,
    parentId,
    children,
    images: [],
    collections: [],
    programIds: [],
    groupIds: [],
    status: null,
    sortOrder: 0,
    version: 1,
    cardImageId: null,
  }
}

const categories: Category[] = [
  makeCategory(1, 'Histology', null, [
    makeCategory(2, 'Epithelium', 1),
    makeCategory(3, 'Connective tissue', 1),
  ]),
  makeCategory(4, 'Radiography'),
]

const meta = {
  title: 'Components/BulkEditCollectionsDialog',
  component: BulkEditCollectionsDialog,
  args: {
    open: true,
    onClose: fn(),
    onSave: fn(async () => undefined),
    onDelete: fn(async () => undefined),
    categories,
    selectedCount: 3,
  },
  parameters: {
    layout: 'fullscreen',
    chromatic: { pauseAnimationAtEnd: true, delay: 300 },
  },
} satisfies Meta<typeof BulkEditCollectionsDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Curator view — admin/instructor: refile picker, visibility switch, and delete. */
export const Basic: Story = {
  args: {
    canCurate: true,
    canDeleteAll: true,
  },
  parameters: {
    // CategoryPickerSelect renders expand/edit IconButtons inside `option`
    // rows — nested-interactive debt shared with the sibling move dialogs.
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByText(/Editing 3 selected collections/)).toBeInTheDocument()
    await expect(await body.findByRole('combobox')).toBeInTheDocument()
    await expect(
      await body.findByRole('button', { name: 'Delete 3 Selected Collections' }),
    ).toBeEnabled()
  },
}

/** Refilling private rows warns that their Browse tiles remain private. */
export const PrivateFilingWarning: Story = {
  args: {
    canCurate: true,
    privateSelectedCount: 2,
  },
  parameters: {
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('combobox'))
    const listbox = await body.findByRole('listbox')
    await userEvent.click(await within(listbox).findByRole('option', { name: /^Histology/ }))
    await expect(
      await body.findByText(
        '2 of the 3 selected collections are private. Filed on Browse, their tiles are visible only to their owners and to staff, instructors and admins — not to other students.',
      ),
    ).toBeInTheDocument()
  },
}

/** Two-step delete — the first click arms the confirmation (#1578). */
export const DeleteConfirm: Story = {
  args: {
    canCurate: true,
    canDeleteAll: true,
  },
  parameters: {
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: 'Delete 3 Selected Collections' }),
    )
    await expect(
      await body.findByRole('button', { name: 'Confirm Delete 3 Collections' }),
    ).toBeInTheDocument()
    await expect(await body.findByText(/This action cannot be undone/)).toBeInTheDocument()
  },
}

/** Non-curator (staff/student owner) — no curator fields, delete only. */
export const DeleteOnly: Story = {
  args: {
    canCurate: false,
    canDeleteAll: true,
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByRole('button', { name: 'Delete 3 Selected Collections' }),
    ).toBeEnabled()
    expect(body.queryByRole('combobox')).not.toBeInTheDocument()
    expect(body.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
  },
}

/** Every selected collection sits under a hidden category — the visibility
 *  switch locks (same convention as Bulk Edit Images). */
export const AllCategoryHidden: Story = {
  args: {
    canCurate: true,
    canDeleteAll: true,
    allCategoryHidden: true,
  },
  parameters: {
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(await body.findByRole('switch', { name: /hidden by category/i })).toBeDisabled()
  },
}

/** Some selected rows aren't deletable by this user — delete is disabled. */
export const PartiallyDeletable: Story = {
  args: {
    canCurate: false,
    canDeleteAll: false,
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByRole('button', { name: 'Delete 3 Selected Collections' }),
    ).toBeDisabled()
  },
}
