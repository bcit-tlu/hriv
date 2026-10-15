import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import type { ImageDetailsDrawerProps } from './ImageDetailsDrawer'
import ImageDetailsDrawer from './ImageDetailsDrawer'

const IMAGE = {
  copyright: '© Museo del Duomo',
  createdAt: '2025-01-02T03:04:05Z',
  updatedAt: '2025-02-03T04:05:06Z',
  width: 4820,
  height: 3210,
  fileSize: 4_718_592,
} satisfies ImageDetailsDrawerProps['image']

interface StoryArgs {
  image: ImageDetailsDrawerProps['image']
  programNames: string[]
  groupNames: string[]
  measurement?: ImageDetailsDrawerProps['measurement']
  sourceInfo?: ImageDetailsDrawerProps['sourceInfo']
  initialOpen: boolean
}

function ImageDetailsDrawerExample(args: StoryArgs) {
  const [open, setOpen] = useState(args.initialOpen)

  return (
    // Stands in for the OSD container the drawer is portaled into.
    <Box sx={{ position: 'relative', width: 720, height: 420, bgcolor: 'grey.900' }}>
      <ImageDetailsDrawer
        image={args.image}
        programNames={args.programNames}
        groupNames={args.groupNames}
        measurement={args.measurement}
        sourceInfo={args.sourceInfo}
        open={open}
        onOpenChange={setOpen}
      />
    </Box>
  )
}

const meta = {
  title: 'Components/ImageDetailsDrawer',
  component: ImageDetailsDrawerExample,
  args: {
    image: {},
    programNames: [],
    groupNames: [],
    initialOpen: false,
  },
  parameters: {
    chromatic: {
      modes: {
        light: { theme: 'light' },
        dark: { theme: 'dark' },
      },
    },
  },
} satisfies Meta<typeof ImageDetailsDrawerExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Image details' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await expect(await canvas.findByRole('heading', { name: 'Image details' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Close image details' }))
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
}

export const Open: Story = {
  args: {
    image: IMAGE,
    programNames: ['Architecture', 'European Art'],
    groupNames: ['Image Research'],
    measurement: { scale: 12, unit: 'mm' },
    sourceInfo: {
      originalFilename: 'duomo-archival-scan.tif',
      fileType: 'TIF',
      uploadedByName: 'Mira Patel',
    },
    initialOpen: true,
  },
}

export const LongValues: Story = {
  args: {
    image: {
      ...IMAGE,
      copyright:
        '© Museo Nazionale del Duomo — archival reproduction licensed for educational use under a long institutional credit line',
    },
    sourceInfo: {
      originalFilename: 'duomo-north-facade-ultra-high-resolution-archival-scan-2025-01.tif',
      fileType: 'TIF',
      uploadedByName: 'Mira Patel',
    },
    initialOpen: true,
  },
}
