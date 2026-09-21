import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import NoteDisplay from './NoteDisplay'

// Mobile/desktop × light/dark snapshots inherited from global modes (preview.tsx).
const meta = {
  title: 'Components/NoteDisplay',
  component: NoteDisplay,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Collapsible note text with a Show more/less toggle. Truncates via line-clamp ' +
          'when the note exceeds the collapsed line budget or an estimated wrap length.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Box sx={{ maxWidth: 420 }}>
        <Story />
      </Box>
    ),
  ],
  argTypes: {
    note: { control: 'text' },
    collapsedLines: { control: { type: 'number', min: 1, max: 6 } },
  },
} satisfies Meta<typeof NoteDisplay>

export default meta

type Story = StoryObj<typeof meta>

export const Short: Story = {
  args: { note: 'North elevation, morning light.' },
}

export const LongTruncated: Story = {
  name: 'Long (truncated + Show more)',
  args: {
    note: 'This image was scanned from the original 35mm slide held in the departmental archive. It shows the north elevation shortly after completion, before the surrounding landscaping was installed. Note the temporary access ramp on the left, which was removed the following spring.',
  },
}

export const Multiline: Story = {
  args: {
    note: 'Line one.\nLine two.\nLine three.\nLine four — this one pushes past the collapsed budget.',
  },
}
