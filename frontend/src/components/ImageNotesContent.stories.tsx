import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import { expect, within } from 'storybook/test'
import ViewportDialog from './ViewportDialog'
import ImageNotesContent from './ImageNotesContent'
import { imageNotesTitle } from './imageNotesTitle'

type Args = { description: string | null; instructorNote: string | null }

function NotesDialogExample({ description, instructorNote }: Args) {
  return (
    <Box sx={{ position: 'relative', height: 360, bgcolor: 'action.hover', overflow: 'hidden' }}>
      <ViewportDialog open title={imageNotesTitle(description, instructorNote)} onClose={() => {}}>
        <ImageNotesContent description={description} instructorNote={instructorNote} />
      </ViewportDialog>
    </Box>
  )
}

const meta = {
  title: 'Components/ImageNotesContent',
  component: NotesDialogExample,
  args: {
    description:
      'Hairline fracture, week two.\nCompare the cortical line against the baseline scan.',
    instructorNote: null,
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 720, maxWidth: '100%' }}>
        <Story />
      </Box>
    ),
  ],
  parameters: {
    chromatic: {
      modes: {
        light: { theme: 'light' },
        dark: { theme: 'dark' },
      },
    },
  },
} satisfies Meta<typeof NotesDialogExample>

export default meta

type Story = StoryObj<typeof meta>

export const DescriptionOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('dialog', { name: 'Description' })).toBeInTheDocument()
  },
}

export const WithInstructorNote: Story = {
  args: {
    instructorNote: 'Ask students to locate the fracture line before revealing it.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('dialog', { name: 'Description & instructor note' }),
    ).toBeInTheDocument()
  },
}
