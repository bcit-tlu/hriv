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

    // The …more→end gap matches the title→Notes gap (within 2px).
    const titleRect = canvas.getByRole('heading', { level: 2 }).getBoundingClientRect()
    const notesLabel = canvas.getByText('Notes:').getBoundingClientRect()
    const endFirst = canvas.getByText('2 of 6').getBoundingClientRect()
    const moreRect = more.getBoundingClientRect()
    const titleGap = notesLabel.left - titleRect.right
    const moreGap = endFirst.left - moreRect.right
    await expect(Math.abs(titleGap - moreGap)).toBeLessThanOrEqual(2)
  },
}

export const LongTitle: Story = {
  args: {
    // Kyle's longest real image names; both must fit without an ellipsis at 1280.
    name: 'Slide 27-117 MARK Connor Lymphoma Cells in CSF Image 10',
    note: 'Long titles share the row with the note.',
  },
  decorators: [
    // Full-width row like the image view / sequence caption (fixed 1200px so
    // the assertion holds regardless of the test browser's viewport).
    (Story) => (
      <Box sx={{ width: 1200, bgcolor: 'background.default', p: 1 }}>
        <Story />
      </Box>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { level: 2 })
    for (const name of [
      'Slide 27-117 MARK Connor Lymphoma Cells in CSF Image 10',
      'Slide 36-102 JACOBI Desiree Image 9 close up Image 2',
    ]) {
      const original = title.textContent
      title.textContent = name
      await expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth)
      title.textContent = original
    }
  },
}

export const NoNote: Story = {
  args: {
    note: null,
  },
}
