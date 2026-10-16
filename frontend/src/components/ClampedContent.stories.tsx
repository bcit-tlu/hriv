import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import ClampedContent from './ClampedContent'

const meta = {
  title: 'Components/ClampedContent',
  component: ClampedContent,
  args: {
    popoverHeading: 'Notes',
    moreAriaLabel: 'Show full note',
  },
  decorators: [
    (Story) => (
      // The clamp sits directly on the page surface (no own background).
      <Box sx={{ width: 480, maxWidth: '100%', bgcolor: 'background.default', p: 1 }}>
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
} satisfies Meta<typeof ClampedContent>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    children: 'A short note that fits on one line.',
    lines: 1,
  },
}

export const Overflowing: Story = {
  args: {
    lines: 1,
    preWrap: true,
    fullContent:
      'Fracture line visible along the parietal.\nCallus forming medially.\nHealing stage consistent with week six.',
    children:
      'Fracture line visible along the parietal. Callus forming medially. Healing stage consistent with week six.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const more = await canvas.findByRole('button', { name: 'Show full note' })
    await userEvent.click(more)
    const popover = await within(document.body).findByRole('presentation')
    await expect(within(popover).getByText('Notes')).toBeInTheDocument()
    await expect(within(popover).getByText(/Callus forming/)).toBeInTheDocument()
  },
}
