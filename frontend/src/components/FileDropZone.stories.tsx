import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import Box from '@mui/material/Box'
import FileDropZone from './FileDropZone'

const meta = {
  title: 'Components/FileDropZone',
  component: FileDropZone,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Drop target for file uploads. `isDragActive` reflects a page-level drag and drives ' +
          'the highlighted affordance; `onDrop` receives the dropped File list.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 560 }}>
        <Story />
      </Box>
    ),
  ],
  args: { onDrop: fn() },
} satisfies Meta<typeof FileDropZone>

export default meta

type Story = StoryObj<typeof meta>

export const Idle: Story = {
  args: { isDragActive: false },
}

export const DragActive: Story = {
  name: 'Drag Active',
  args: { isDragActive: true },
}
