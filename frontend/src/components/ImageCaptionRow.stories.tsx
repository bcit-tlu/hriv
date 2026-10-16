import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import ImageIcon from '@mui/icons-material/Image'
import ImageCaptionRow from './ImageCaptionRow'

const meta = {
  title: 'Components/ImageCaptionRow',
  component: ImageCaptionRow,
  args: {
    name: 'Skull — lateral',
    active: true,
    onShowNote: fn(),
    end: (
      <>
        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
          2 of 6
        </Typography>
        <Button size="small" variant="text" endIcon={<ImageIcon />}>
          Open image
        </Button>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 700, maxWidth: '100%', bgcolor: 'background.default', p: 1 }}>
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
} satisfies Meta<typeof ImageCaptionRow>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    note: 'Hairline fracture, week two.',
  },
}

export const LongNote: Story = {
  args: {
    note: 'Follow-up scan after the cast was removed.\nCallus forming along the medial edge.\nHealing consistent with week six.\nCompare the cortical thickening against the baseline scan; remodelling continues through week twelve.',
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const more = await canvas.findByRole('button', { name: 'Show full note' })
    await userEvent.click(more)
    await expect(args.onShowNote).toHaveBeenCalled()
  },
}

export const NoNote: Story = {
  args: {
    note: null,
  },
}
