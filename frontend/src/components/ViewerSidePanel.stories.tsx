import { useState } from 'react'
import Box from '@mui/material/Box'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import ViewerSidePanel, { ViewerPanelToggle } from './ViewerSidePanel'
import { ImageMarkersList } from './ImageMarkersDrawer'
import { ImageDetailsContent } from './ImageDetailsDrawer'
import { BOARD_FIXTURE, MARKER_FIXTURE } from './markerFixtures'
import { BOARD_USER } from './boardsFixtures'
import { useMarkerVisibilityPrefs } from '../useMarkerVisibilityPrefs'
import type { ViewerPanelTab } from '../useViewerPanelState'

const copyView = fn()

function Example({
  initialOpen = false,
  initialTab = 'markers',
  saved = false,
}: {
  initialOpen?: boolean
  initialTab?: ViewerPanelTab
  saved?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)
  const [tab, setTab] = useState<ViewerPanelTab>(initialTab)
  const prefs = useMarkerVisibilityPrefs()
  const items = saved
    ? [MARKER_FIXTURE, { ...MARKER_FIXTURE, id: 8, title: 'New saved view' }]
    : [MARKER_FIXTURE]
  return (
    <Box
      sx={{ height: 560, position: 'relative', overflow: 'hidden', bgcolor: 'background.default' }}
    >
      <Box
        component="img"
        alt="Example image"
        src="/hriv-splash2.jpg"
        sx={{
          height: '100%',
          objectFit: 'cover',
          width: { xs: '100%', sm: open ? 'calc(100% - 256px)' : '100%' },
        }}
      />
      {!open && (
        <Box sx={{ position: 'absolute', top: 0, right: 0 }}>
          <ViewerPanelToggle open={false} onToggle={() => setOpen(true)} panelId="example-panel" />
        </Box>
      )}
      <ViewerSidePanel
        open={open}
        tab={tab}
        onTabChange={setTab}
        onClose={() => setOpen(false)}
        panelId="example-panel"
        onShareView={copyView}
        markers={
          <ImageMarkersList
            items={items}
            boards={[BOARD_FIXTURE]}
            currentUser={BOARD_USER}
            selectedId={saved ? 8 : null}
            focusId={saved ? 8 : null}
            drawerId="example-list"
            prefs={prefs}
            onSelect={() => {}}
            onEdit={() => {}}
          />
        }
        details={
          <ImageDetailsContent
            dense
            image={{ copyright: 'Educational specimen', width: 4820, height: 3210 }}
            programNames={['Histology']}
            groupNames={[]}
          />
        }
      />
    </Box>
  )
}
const meta = {
  title: 'Components/ViewerSidePanel',
  component: Example,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Example>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Open viewer panel' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}
export const Markers: Story = {
  args: { initialOpen: true },
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
    await userEvent.click(canvas.getByRole('button', { name: 'Rose window options' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(canvas.getByRole('img', { name: 'Example image' }))
    await expect(canvas.getByRole('complementary', { name: 'Viewer panel' })).toBeVisible()
  },
}
export const Details: Story = {
  args: { initialOpen: true, initialTab: 'details' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show image details' }))
    await expect(canvas.getByText('Dimensions:').parentElement).toHaveTextContent('4820 × 3210')
    await expect(canvas.getByRole('button', { name: 'Show image details' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}
export const SharedView: Story = {
  args: { initialOpen: true, initialTab: 'share' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Copy current view' }))
    await expect(copyView).toHaveBeenCalled()
    await expect(canvas.getByRole('button', { name: 'Show Shared View' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}
export const NewlySaved: Story = {
  args: { initialOpen: true, saved: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: 'View Marker: New saved view' })
    await expect(row).toHaveFocus()
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByRole('button', { name: 'View Marker: Rose window' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  },
}
