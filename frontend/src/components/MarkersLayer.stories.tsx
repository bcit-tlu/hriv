import { useRef } from 'react'
import OpenSeadragon from 'openseadragon'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within, waitFor } from 'storybook/test'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ImageViewer from './ImageViewer'
import { useMarkerVisibilityPrefs } from '../useMarkerVisibilityPrefs'
import type { ApiMarker } from '../types'
import { BOARD_FIXTURE, MARKER_FIXTURE } from './markerFixtures'

const items: ApiMarker[] = [
  MARKER_FIXTURE,
  {
    ...MARKER_FIXTURE,
    id: 8,
    x: 0.6,
    y: 0.38,
    title: 'Stone columns',
    source: 'instructor',
    permissions: { can_edit: false, can_delete: false },
  },
]
const tileSource = { type: 'image', url: '/hriv-splash2.jpg', width: 1024, height: 1024 }
function MarkerViewer() {
  const viewer = useRef<OpenSeadragon.Viewer | null>(null)
  const prefs = useMarkerVisibilityPrefs()
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
        <Button
          onClick={() => {
            for (const item of items) {
              prefs.setItem(item, 'markerVisible', true)
              prefs.setItem(item, 'labelVisible', true)
            }
          }}
        >
          Reset visibility
        </Button>
      </Box>
      <ImageViewer
        imageId={42}
        markersEnabled
        height={560}
        tileSources={tileSource}
        onViewerReady={(value) => {
          viewer.current = value
        }}
      />
    </Box>
  )
}
const meta = {
  title: 'Components/MarkersLayer',
  component: MarkerViewer,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    localStorage.removeItem('hrivpref:markers-drawer:pinned:user:anonymous')
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(url, window.location.href).pathname
      if (path === '/api/images/42/markers') return Response.json(items)
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
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Reset visibility' }))
    await expect(
      await within(canvasElement).findByRole('button', { name: 'View Marker: Rose window' }),
    ).toBeInTheDocument()
  },
}
export const IndependentVisibility: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Reset visibility' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Open viewer panel' }))
    const drawer = within(canvas.getByRole('complementary'))
    await userEvent.click(drawer.getByRole('button', { name: 'Rose window options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'Rose window marker' }))
    await userEvent.click(drawer.getByRole('button', { name: 'Stone columns options' }))
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('menuitemcheckbox', {
        name: 'Stone columns labels',
      }),
    )
    await userEvent.click(drawer.getByRole('button', { name: 'Close viewer panel' }))
    await waitFor(() => expect(canvas.queryByRole('complementary')).not.toBeInTheDocument())
    await expect(
      canvas.queryByRole('button', { name: 'View Marker: Rose window' }),
    ).not.toBeInTheDocument()
    await expect(canvas.getByText('Rose window')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'View Marker: Stone columns' })).toBeVisible()
  },
}
export const Placement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Reset visibility' }))
    await canvas.findByRole('button', { name: 'View Marker: Rose window' })
    const tool = canvasElement.querySelector<HTMLElement>('[title="Add Marker"]')
    const surface = canvasElement.querySelector<HTMLElement>('.openseadragon-canvas')
    if (!tool || !surface) throw new Error('Viewer controls are not mounted')
    await userEvent.click(tool)
    await userEvent.click(canvas.getByRole('button', { name: 'Open viewer panel' }))
    const frame = surface.closest('[data-viewer-image-area]')!.parentElement!
    await waitFor(() =>
      expect(surface.getBoundingClientRect().width).toBeCloseTo(frame.clientWidth - 256, 0),
    )
    await waitFor(() =>
      expect(surface.querySelector('canvas')?.width).toBeCloseTo(
        surface.clientWidth * window.devicePixelRatio,
        0,
      ),
    )
    const bounds = surface.getBoundingClientRect()
    const placementX = bounds.x + bounds.width / 4
    const placementY = bounds.y + 220
    await userEvent.pointer({
      target: surface,
      keys: '[MouseLeft]',
      coords: {
        clientX: placementX,
        clientY: placementY,
        pageX: placementX,
        pageY: placementY,
      },
    })
    const page = within(canvasElement.ownerDocument.body)
    await expect(canvas.getByRole('button', { name: 'Close viewer panel' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(await page.findByRole('heading', { name: 'Add Marker' })).toBeInTheDocument()
    await expect(
      within(canvas.getByRole('region', { name: 'Markers list' })).getByText('New Marker'),
    ).toBeVisible()
    const draft = canvasElement.querySelector('[data-marker-id="-1"]')!.getBoundingClientRect()
    await expect(draft.x).toBeCloseTo(placementX, 0)
    await expect(draft.y).toBeCloseTo(placementY, 0)
    await userEvent.keyboard('A closer look')
    await expect(page.getByRole('textbox', { name: /^Title/ })).toHaveValue('A closer look')
    // Description field is always visible, no collapsed More options (#1952).
    await expect(page.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument()
  },
}
export const InfoCard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Reset visibility' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'View Marker: Rose window' }))
    await expect(await canvas.findByRole('region', { name: 'Marker information' })).toBeVisible()
    await expect(await canvas.findByText(BOARD_FIXTURE.name)).toBeVisible()
    await expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
  },
}
