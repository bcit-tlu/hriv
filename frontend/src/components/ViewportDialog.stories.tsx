import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ViewportDialog from './ViewportDialog'

function DialogExample() {
  const [open, setOpen] = useState(true)
  return (
    <Box
      sx={{
        position: 'relative',
        height: 320,
        bgcolor: 'action.hover',
        overflow: 'hidden',
      }}
    >
      {!open && <Button onClick={() => setOpen(true)}>Reopen</Button>}
      <ViewportDialog open={open} title="Notes" onClose={() => setOpen(false)}>
        <Box sx={{ typography: 'body2', whiteSpace: 'pre-wrap' }}>
          {
            'The cathedral’s construction began in 1386.\nThe main façade was completed in the 19th century.'
          }
        </Box>
      </ViewportDialog>
    </Box>
  )
}

const meta = {
  title: 'Components/ViewportDialog',
  component: DialogExample,
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
} satisfies Meta<typeof DialogExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {}
