/**
 * Tests for ViewportDialog — the small dialog rendered over the OSD
 * viewport through ImageViewer's viewportOverlay portal.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ViewportDialog from '../../src/components/ViewportDialog'

function renderDialog(
  overrides: Partial<Parameters<typeof ViewportDialog>[0]> = {},
  children = <div>Dialog body</div>,
) {
  const onClose = vi.fn()
  const utils = render(
    <div style={{ position: 'relative' }}>
      <button>Opener</button>
      <ViewportDialog open title="Notes" onClose={onClose} {...overrides}>
        {children}
      </ViewportDialog>
    </div>,
  )
  return { onClose, ...utils }
}

describe('ViewportDialog', () => {
  it('renders a named dialog with aria-modal', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Notes' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('Dialog body')
  })

  it('renders nothing when closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('focuses the close button on open and restores focus on close', () => {
    const { rerender, unmount } = render(
      <div>
        <button>Opener</button>
        <ViewportDialog open={false} title="Notes" onClose={vi.fn()}>
          <div>Body</div>
        </ViewportDialog>
      </div>,
    )
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()

    rerender(
      <div>
        <button>Opener</button>
        <ViewportDialog open={true} title="Notes" onClose={vi.fn()}>
          <div>Body</div>
        </ViewportDialog>
      </div>,
    )
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    rerender(
      <div>
        <button>Opener</button>
        <ViewportDialog open={false} title="Notes" onClose={vi.fn()}>
          <div>Body</div>
        </ViewportDialog>
      </div>,
    )
    expect(document.activeElement).toBe(opener)
    unmount()
  })

  it('closes on Escape', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a backdrop click but not a content click', () => {
    const { onClose } = renderDialog()
    const backdrop = screen.getByRole('presentation')
    const dialog = screen.getByRole('dialog')

    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops pointer and wheel gestures from reaching OSD', () => {
    // stopPropagation keeps dialog gestures off the container's handlers.
    const parentHandler = vi.fn()
    const { container } = render(
      <div onPointerDown={parentHandler} onWheel={parentHandler}>
        <ViewportDialog open title="Notes" onClose={vi.fn()}>
          <div>Body</div>
        </ViewportDialog>
      </div>,
    )
    const root = container.querySelector('[data-hriv-canvas-ui]')!
    fireEvent.pointerDown(root)
    fireEvent.wheel(root)
    expect(parentHandler).not.toHaveBeenCalled()
  })
})
