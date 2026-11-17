import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import ViewerSidePanel, { ViewerPanelToggle } from '../../src/components/ViewerSidePanel'
import type { ViewerPanelTab } from '../../src/useViewerPanelState'

function Example({ error = false, onShareView }: { error?: boolean; onShareView?: () => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ViewerPanelTab>('inuksuks')
  return (
    <div>
      {!open && <ViewerPanelToggle open={false} onToggle={() => setOpen(true)} panelId="panel" />}
      <ViewerSidePanel
        panelId="panel"
        open={open}
        tab={tab}
        onTabChange={setTab}
        onClose={() => setOpen(false)}
        onShareView={onShareView}
        inuksuks={
          error ? (
            <div role="alert">Unable to load Inuksuks.</div>
          ) : (
            <p>No Inuksuks on this image.</p>
          )
        }
      />
    </div>
  )
}

it('toggles with accessible controls, retains a selected tab, and never closes on tab re-selection, outside press or Escape', () => {
  render(<Example />)
  const toggle = screen.getByRole('button', { name: 'Open viewer panel' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveAttribute('aria-controls', 'panel')
  expect(screen.queryByRole('complementary')).toBeNull()
  fireEvent.click(toggle)
  expect(screen.queryByRole('heading', { name: /^Inuksuks/ })).not.toBeInTheDocument()
  expect(screen.getByText('No Inuksuks on this image.')).toBeVisible()
  expect(screen.getByRole('region', { name: 'About Inuksuks' })).toHaveAttribute('tabindex', '0')
  expect(screen.getByRole('region', { name: 'About Inuksuks' })).toHaveTextContent(
    'Inuksuks save a location and zoom level',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Show image details' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show image details' }))
  expect(screen.getByRole('button', { name: 'Show image details' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByText('No details available.')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Viewer controls' })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Viewer controls' })).toHaveAttribute('tabindex', '0')
  expect(screen.getByRole('region', { name: 'Viewer controls' })).toHaveTextContent(
    'Scroll or tap to zoom',
  )
  fireEvent.pointerDown(document.body)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('complementary')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Close viewer panel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open viewer panel' }))
  expect(screen.getByRole('button', { name: 'Show image details' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

it('surfaces list loading errors without removing the panel controls', () => {
  render(<Example error />)
  fireEvent.click(screen.getByRole('button', { name: 'Open viewer panel' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load Inuksuks.')
  expect(screen.getByRole('button', { name: 'Close viewer panel' })).toBeEnabled()
})
it('places Shared View between Inuksuks and Details and invokes the existing copy action', () => {
  const copy = vi.fn()
  render(<Example onShareView={copy} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open viewer panel' }))
  expect(screen.getByRole('group', { name: 'Viewer panel content' }).textContent).toBeDefined()
  const tabs = screen
    .getByRole('group', { name: 'Viewer panel content' })
    .querySelectorAll('button')
  expect([...tabs].map((tab) => tab.getAttribute('aria-label'))).toEqual([
    'Show Inuksuks',
    'Show Shared View',
    'Show image details',
  ])
  fireEvent.click(screen.getByRole('button', { name: 'Show Shared View' }))
  fireEvent.click(screen.getByRole('button', { name: 'Copy current view' }))
  expect(copy).toHaveBeenCalledTimes(1)
})
it('disables copying when no view action is available', () => {
  render(<Example />)
  fireEvent.click(screen.getByRole('button', { name: 'Open viewer panel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show Shared View' }))
  expect(screen.getByRole('button', { name: 'Copy current view' })).toBeDisabled()
})
