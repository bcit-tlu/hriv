import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import ImageViewer from './ImageViewer'
import ImageDetailsDrawer, { ImageDetailsTrigger } from './ImageDetailsDrawer'

const IMAGE = {
  copyright: '© Museo del Duomo',
  createdAt: '2025-01-02T03:04:05Z',
  updatedAt: '2025-02-03T04:05:06Z',
  width: 4820,
  height: 3210,
  fileSize: 4_718_592,
}

function ImageViewerExample() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <Box sx={{ width: 720 }}>
      <ImageViewer
        tileSources="/sample.dzi"
        height={420}
        viewportControl={
          <ImageDetailsTrigger open={open} onOpenChange={setOpen} triggerRef={triggerRef} />
        }
        viewportOverlay={
          <ImageDetailsDrawer
            image={IMAGE}
            programNames={['Architecture']}
            groupNames={['Image Research']}
            open={open}
            onOpenChange={setOpen}
            triggerRef={triggerRef}
          />
        }
      />
    </Box>
  )
}

const meta = {
  title: 'Components/ImageViewer',
  component: ImageViewerExample,
} satisfies Meta<typeof ImageViewerExample>

export default meta

export const WithImageDetails: StoryObj<typeof meta> = {}
