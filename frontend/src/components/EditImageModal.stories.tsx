import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import EditImageModal from './EditImageModal'
import { categoryTree, makeImage, PROGRAMS, GROUPS } from './storyFixtures'

const meta = {
  title: 'Components/EditImageModal',
  component: EditImageModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Edits a single image: category, copyright, note, visibility, and (optionally) ' +
          'replacing the underlying file. Reuses the shared metadata fields and category picker.',
      },
    },
  },
  args: {
    open: true,
    image: makeImage(),
    categories: categoryTree(),
    programs: PROGRAMS,
    groups: GROUPS,
    onClose: fn(),
    onSave: fn(),
  },
} satisfies Meta<typeof EditImageModal>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const HiddenImage: Story = {
  name: 'Hidden Image',
  args: { image: makeImage({ active: false, note: 'Restricted archive image.' }) },
}
