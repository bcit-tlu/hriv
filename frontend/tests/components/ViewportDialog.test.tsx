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
    const onClose = vi.fn()
    const tree = (open: boolean) => (
      <div>
        <button>Opener</button>
        <ViewportDialog open={open} title="Notes" onClose={onClose}>
          <div>Body</div>
        </ViewportDialog>
      </div>
    )
    const { rerender, unmount } = render(tree(false))
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()

    rerender(tree(true))
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    // Focus moving inside the dialog (as Tab would) must not be recorded —
    // that element unmounts with the dialog.
    const scrollBody = screen.getByRole('dialog').querySelector<HTMLElement>('[tabindex="0"]')
    scrollBody?.focus()

    // Closing with the ✕ restores focus to the trigger.
    rerender(tree(false))
    expect(opener).toHaveFocus()

    // Reopening and closing with Escape restores it again.
    rerender(tree(true))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(tree(false))
    expect(opener).toHaveFocus()
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
