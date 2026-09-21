import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import CardImagePickerModal from './CardImagePickerModal'
import { makeCategory } from './storyFixtures'

// Rendered with an image-less category to exercise the empty state without
// needing token-backed thumbnail URLs (populated variants are API-dependent).
const meta = {
  title: 'Components/CardImagePickerModal',
  component: CardImagePickerModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Picks which image represents a category card. Shown here in its empty state; ' +
          'populated grids depend on token-backed thumbnails served by the API.',
      },
    },
  },
  args: {
    open: true,
    category: makeCategory({ label: 'Renaissance', images: [] }),
    currentImageId: null,
    onClose: fn(),
    onSave: fn(),
  },
} satisfies Meta<typeof CardImagePickerModal>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {}
