import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import MoveImageDialog from './MoveImageDialog'
import { categoryTree, makeImage, PROGRAMS, GROUPS } from './storyFixtures'

const meta = {
  title: 'Components/MoveImageDialog',
  component: MoveImageDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Moves an image to a different category using the tree-aware category picker.',
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
    onMove: fn(async () => undefined),
  },
} satisfies Meta<typeof MoveImageDialog>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
