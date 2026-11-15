import { useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ImageViewer from './ImageViewer'
import { BOARD_FIXTURE, INUKSUK_FIXTURE } from './inuksukFixtures'

const items = [
  INUKSUK_FIXTURE,
  {
    ...INUKSUK_FIXTURE,
    id: 8,
    x: 0.6,
    y: 0.38,
    title: 'Stone columns',
    source: 'instructor',
    permissions: { can_edit: false, can_delete: false },
  },
]
const tileSource = { type: 'image', url: '/hriv-splash2.jpg', width: 1024, height: 1024 }
function MarkerViewer({ independentVisibility = false }: { independentVisibility?: boolean }) {
  const viewer = useRef<OpenSeadragon.Viewer | null>(null)
  const [separate, setSeparate] = useState(independentVisibility)
  return (
    <Box sx={{ p: 2, maxWidth: 1000 }}>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <Button
          onClick={() => {
            viewer.current?.viewport.setRotation(45)
            viewer.current?.viewport.zoomTo(2)
            viewer.current?.viewport.panTo(new OpenSeadragon.Point(0.52, 0.34))
          }}
        >
          Rotate and zoom
        </Button>
        <Button onClick={() => setSeparate((value) => !value)}>
          Toggle independent visibility
        </Button>
      </Box>
      <ImageViewer
        imageId={42}
        inuksuksEnabled
        height={560}
        tileSources={tileSource}
        inuksukVisibility={
          separate
            ? {
                7: { markerVisible: false, labelVisible: true },
                8: { markerVisible: true, labelVisible: false },
              }
            : undefined
        }
        onViewerReady={(value) => {
          viewer.current = value
        }}
      />
    </Box>
  )
}
const meta = {
  title: 'Components/InuksukMarkersLayer',
  component: MarkerViewer,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, window.location.href).pathname
      if (path === '/api/images/42/inuksuks') return Response.json(items)
      if (path === '/api/boards/1') return Response.json(BOARD_FIXTURE)
      if (path === '/api/boards') return Response.json([BOARD_FIXTURE])
      return original(input, init)
    }
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof MarkerViewer>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('button', { name: 'View Inuksuk: Rose window' }),
    ).toBeInTheDocument()
  },
}
export const IndependentVisibility: Story = { args: { independentVisibility: true } }
export const Placement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'View Inuksuk: Rose window' })
    const tool = canvasElement.querySelector<HTMLElement>('[title="Add Inuksuk"]')
    const surface = canvasElement.querySelector<HTMLElement>('.openseadragon-canvas')
    if (!tool || !surface) throw new Error('Viewer controls are not mounted')
    await userEvent.click(tool)
    const bounds = surface.getBoundingClientRect()
    await userEvent.pointer({
      target: surface,
      keys: '[MouseLeft]',
      coords: { clientX: bounds.x + 260, clientY: bounds.y + 220 },
    })
    const page = within(canvasElement.ownerDocument.body)
    await expect(await page.findByRole('heading', { name: 'Save a view' })).toBeInTheDocument()
    await userEvent.type(page.getByRole('textbox', { name: /^Title/ }), 'A closer look')
    await userEvent.click(page.getByRole('checkbox', { name: 'Favourite' }))
    await expect(page.getByRole('checkbox', { name: 'Favourite' })).toBeChecked()
  },
}
