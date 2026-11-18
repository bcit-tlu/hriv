import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import ImageViewer from './ImageViewer'
import { expect, userEvent, within } from 'storybook/test'
import { MARKER_FIXTURE, BOARD_FIXTURE } from './markerFixtures'
import ImageDetailsDrawer, { ImageDetailsTrigger, ImageDetailsContent } from './ImageDetailsDrawer'

const IMAGE = {
  copyright: '© Museo del Duomo',
  createdAt: '2025-01-02T03:04:05Z',
  updatedAt: '2025-02-03T04:05:06Z',
  width: 4820,
  height: 3210,
  fileSize: 4_718_592,
}

function ImageViewerExample({ markersEnabled = false }: { markersEnabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <Box sx={{ width: '100%', height: '100vh' }}>
      <ImageViewer
        tileSources="/marker-image.json"
        height="100%"
        imageId={42}
        markersEnabled={markersEnabled}
        sidePanelDetails={
          <ImageDetailsContent dense image={IMAGE} programNames={['Histology']} groupNames={[]} />
        }
        viewportControl={
          markersEnabled ? null : (
            <ImageDetailsTrigger open={open} onOpenChange={setOpen} triggerRef={triggerRef} />
          )
        }
        viewportOverlay={
          !markersEnabled && (
            <ImageDetailsDrawer
              image={IMAGE}
              programNames={['Architecture']}
              groupNames={['Image Research']}
              open={open}
              onOpenChange={setOpen}
              triggerRef={triggerRef}
            />
          )
        }
      />
    </Box>
  )
}

const meta = {
  title: 'Components/ImageViewer',
  component: ImageViewerExample,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const path = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        window.location.href,
      ).pathname
      if (/^\/api\/images\/\d+\/markers$/.test(path)) return Response.json([MARKER_FIXTURE])
      if (path === '/api/boards') return Response.json([BOARD_FIXTURE])
      return original(input, init)
    }
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof ImageViewerExample>

export default meta

export const WithImageDetails: StoryObj<typeof meta> = {}

type Story = StoryObj<typeof meta>
export const PanelClosed: Story = {
  args: { markersEnabled: true },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('button', { name: 'Open viewer panel' })
  },
}
export const PanelMarkers: Story = {
  args: { markersEnabled: true },
  parameters: {
    chromatic: {
      modes: {
        light: { theme: 'light' },
        dark: { theme: 'dark' },
        mobile: { theme: 'light', viewport: { width: 390, height: 844 } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Open viewer panel' }))
    await expect(canvas.getByRole('heading', { name: 'Markers (1)' })).toBeVisible()
  },
}
export const PanelDetails: Story = {
  args: { markersEnabled: true },
  play: async (context) => {
    await PanelMarkers.play?.(context)
    await userEvent.click(
      within(context.canvasElement).getByRole('button', { name: 'Show image details' }),
    )
  },
}
