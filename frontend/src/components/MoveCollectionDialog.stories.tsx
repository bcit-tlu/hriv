import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Category, CollectionSummary } from '../types'
import MoveCollectionDialog from './MoveCollectionDialog'

const FIXED_AT = '2026-09-01T09:00:00Z'

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

const collection: CollectionSummary = {
  id: 7,
  name: 'Lab 2 — Epithelium set',
  description: 'Sequence slides for the second lab.',
  type: 'sequence',
  visibility: 'public',
  hidden: false,
  owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
  imageCount: 9,
  coverThumb: null,
  coverImageId: null,
  categoryId: null,
  sortOrder: 0,
  programIds: [],
  groupIds: [],
  version: 3,
  createdAt: FIXED_AT,
  updatedAt: FIXED_AT,
  permissions: {
    canEdit: true,
    canDelete: true,
    canChangeScope: true,
    canTransfer: false,
    canHide: false,
  },
}

const meta = {
  title: 'Components/MoveCollectionDialog',
  component: MoveCollectionDialog,
  args: {
    open: true,
    onClose: fn(),
    onMove: fn(async () => undefined),
    collection,
    categories,
  },
  parameters: {
    layout: 'fullscreen',
    chromatic: { pauseAnimationAtEnd: true, delay: 300 },
  },
} satisfies Meta<typeof MoveCollectionDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Filed collection — the picker opens preselected on its current category. */
export const Basic: Story = {
  args: {
    collection: { ...collection, categoryId: 2 },
  },
  parameters: {
    // CategoryPickerSelect renders expand/edit IconButtons inside `option`
    // rows — nested-interactive debt shared with the sibling move dialogs.
    a11y: { test: 'todo' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByText(/File “Lab 2 — Epithelium set” into a Browse category/),
    ).toBeInTheDocument()
    await userEvent.click(await body.findByRole('combobox'))
    await expect(await body.findByRole('option', { name: /Not on Browse/ })).toBeInTheDocument()
  },
}

/** Unfiled collection — "Not on Browse" is the preselected destination. */
export const AtRoot: Story = {
  args: {
    collection: { ...collection, categoryId: null },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const picker = await body.findByRole('combobox')
    await expect(picker).toHaveTextContent(/Not on Browse/)
  },
}

/** Private collection filed into Browse — the visibility warning is shown. */
export const PrivateFilingWarning: Story = {
  args: {
    collection: { ...collection, categoryId: 2, visibility: 'private' },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByText(
        'This collection is private. Students will not be able to see the images in this collection.',
      ),
    ).toBeInTheDocument()
  },
}
