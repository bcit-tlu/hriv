/**
 * CountObjectsButton (#1667): idle menu, active split button with cancel,
 * done split button with count-again, a11y labels and Esc.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CountObjectsButton from '../../src/components/CountObjectsButton'
import type { SelectionCountEntry } from '../../src/useSelectionCounts'

const SEL = { x: 0, y: 0, width: 10, height: 10 }

function entry(partial: Partial<SelectionCountEntry>): SelectionCountEntry {
  return {
    key: 'sel-1',
    label: 'Selection 1',
    mode: 'cells',
    selection: SEL,
    phase: 'queued',
    queuePosition: null,
    jobId: 'j1',
    ...partial,
  }
}

function renderButton(overrides: Partial<Parameters<typeof CountObjectsButton>[0]> = {}) {
  const props = {
    selectionIndex: 2,
    onCount: vi.fn(),
    onCancel: vi.fn(),
    onViewResults: vi.fn(),
    ...overrides,
  }
  render(<CountObjectsButton {...props} />)
  return props
}

describe('CountObjectsButton', () => {
  it('idle: opens the Cells/Nuclei menu and calls onCount', async () => {
    const user = userEvent.setup()
    const props = renderButton()
    const button = screen.getByRole('button', {
      name: 'Count objects in selection 2',
    })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Whole cells, e.g. blood cells')).toBeInTheDocument()
    expect(screen.getByText('Cell nuclei, e.g. tissue sections')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /Cells/ }))
    expect(props.onCount).toHaveBeenCalledWith('cells')
    await user.click(button)
    await user.click(screen.getByRole('menuitem', { name: /Nuclei/ }))
    expect(props.onCount).toHaveBeenCalledWith('nuclei')
  })

  it('idle: Esc closes the menu without counting', async () => {
    const user = userEvent.setup()
    const props = renderButton()
    await user.click(screen.getByRole('button', { name: 'Count objects in selection 2' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Whole cells, e.g. blood cells')).not.toBeInTheDocument()
    expect(props.onCount).not.toHaveBeenCalled()
  })

  it('carries data-hriv-canvas-ui so the OSD tracker skips it', () => {
    renderButton()
    expect(
      screen
        .getByRole('button', { name: 'Count objects in selection 2' })
        .closest('[data-hriv-canvas-ui]'),
    ).not.toBeNull()
  })

  it('active: shows "Counting…" with a spinner and a Cancel dropdown', async () => {
    const user = userEvent.setup()
    const props = renderButton({ entry: entry({ phase: 'running' }) })
    expect(screen.getByText('Counting…')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'Count objects in selection 2 — more actions',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Cancel count' }))
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('active: shows "Queued · n ahead" while queued behind others', () => {
    renderButton({ entry: entry({ phase: 'queued', queuePosition: 3 }) })
    expect(screen.getByText('Queued · 3 ahead')).toBeInTheDocument()
  })

  it('done: main button reopens the report; dropdown offers count-again', async () => {
    const user = userEvent.setup()
    const props = renderButton({
      entry: entry({
        phase: 'done',
        result: { total: 77, groups: [], objects: [], preview: null },
      }),
    })
    await user.click(screen.getByRole('button', { name: 'View results (77)' }))
    expect(props.onViewResults).toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', {
        name: 'Count objects in selection 2 — more actions',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Count nuclei again' }))
    expect(props.onCount).toHaveBeenCalledWith('nuclei')
  })

  it('failed: back to the idle button', () => {
    renderButton({ entry: entry({ phase: 'failed', error: 'internal' }) })
    expect(screen.getByRole('button', { name: 'Count objects in selection 2' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Count objects in selection 2' }))
    expect(screen.getByText('Cells')).toBeInTheDocument()
  })

  it('renders the menu inside menuContainer when provided', async () => {
    const user = userEvent.setup()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onCount = vi.fn()
    render(
      <CountObjectsButton
        selectionIndex={2}
        menuContainer={container}
        onCount={onCount}
        onCancel={() => {}}
        onViewResults={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Count objects in selection 2' }))
    // Menu items appear inside the container, not document.body.
    expect(container.querySelector('[role="menuitem"]')).not.toBeNull()
    expect(within(container).getByRole('menuitem', { name: /Cells/ })).toBeInTheDocument()
  })
})
