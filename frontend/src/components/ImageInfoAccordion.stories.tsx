import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import type { ImageInfoAccordionProps } from './ImageInfoAccordion'
import ImageInfoAccordion from './ImageInfoAccordion'

const IMAGE = {
  id: 1621,
  copyright: '© Museo del Duomo',
  note: 'The cathedral’s construction began in 1386.\nThe main façade was completed in the 19th century.\nRestoration continues today.',
  createdAt: '2025-01-02T03:04:05Z',
  updatedAt: '2025-02-03T04:05:06Z',
  width: 4820,
  height: 3210,
  fileSize: 4_718_592,
} satisfies ImageInfoAccordionProps['image']

interface StoryArgs {
  image: ImageInfoAccordionProps['image']
  programNames: string[]
  groupNames: string[]
  measurement?: ImageInfoAccordionProps['measurement']
  sourceInfo?: ImageInfoAccordionProps['sourceInfo']
  initialExpanded: boolean
}

function ImageInfoAccordionExample(args: StoryArgs) {
  const [expanded, setExpanded] = useState(args.initialExpanded)

  return (
    <Box sx={{ p: 3 }}>
      <ImageInfoAccordion
        image={args.image}
        programNames={args.programNames}
        groupNames={args.groupNames}
        measurement={args.measurement}
        sourceInfo={args.sourceInfo}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
    </Box>
  )
}

const meta = {
  title: 'Components/ImageInfoAccordion',
  component: ImageInfoAccordionExample,
  args: {
    image: { id: 1621 },
    programNames: [],
    groupNames: [],
    initialExpanded: false,
  },
  parameters: {
    chromatic: {
      modes: {
        light: { theme: 'light' },
        dark: { theme: 'dark' },
      },
    },
  },
} satisfies Meta<typeof ImageInfoAccordionExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = canvas.getByRole('button', { name: 'Image information' })
    await expect(summary).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(summary)
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(summary)
    await expect(summary).toHaveAttribute('aria-expanded', 'false')
  },
}

export const Expanded: Story = {
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
    initialExpanded: true,
  },
}
