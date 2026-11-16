import { useRef, useState } from 'react'
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import Drawer, { ImageInuksuksTrigger } from '../../src/components/ImageInuksuksDrawer'
import { useInuksukVisibilityPrefs } from '../../src/useInuksukVisibilityPrefs'
import { INUKSUK_FIXTURE } from '../../src/components/inuksukFixtures'
import type { ApiInuksuk } from '../../src/types'

const rows: ApiInuksuk[] = [
  INUKSUK_FIXTURE,
  { ...INUKSUK_FIXTURE, id: 8, title: 'My second', source: 'mine' },
  {
    ...INUKSUK_FIXTURE,
    id: 9,
    title: 'Instructor view',
    source: 'instructor',
    permissions: { can_edit: false, can_delete: false },
  },
  {
    ...INUKSUK_FIXTURE,
    id: 10,
    title: 'Public view',
    source: 'public',
    permissions: { can_edit: false, can_delete: false },
  },
]
function Example({
  items = rows,
  onSelect = vi.fn(),
  onEdit = vi.fn(),
  error,
}: {
  items?: ApiInuksuk[]
  onSelect?: (item: ApiInuksuk) => void
  onEdit?: (item: ApiInuksuk) => void
  error?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const prefs = useInuksukVisibilityPrefs(9)
  return (
    <div style={{ position: 'relative', width: 600, height: 600 }}>
      <ImageInuksuksTrigger
        open={open}
        count={items.length}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        drawerId="drawer"
      />
      <Drawer
        drawerId="drawer"
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        items={items}
        prefs={prefs}
        error={error}
        onSelect={onSelect}
        onEdit={onEdit}
      />
    </div>
  )
}
beforeEach(() => localStorage.clear())
describe('ImageInuksuksDrawer', () => {
  it.each(['light', 'dark'] as const)('uses %s theme colors for the trigger', (mode) => {
    const theme = createTheme({ palette: { mode } })
    render(
      <ThemeProvider theme={theme}>
        <Example />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button', { name: 'Inuksuks (4)' })).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.333)',
      color: '#fff',
    })
  })
  it('groups by source, defaults public collapsed, navigates only on the row and restricts editing', () => {
    const select = vi.fn()
    const edit = vi.fn()
    render(<Example onSelect={select} onEdit={edit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (4)' }))
    expect(screen.getByRole('button', { name: 'My Inuksuks' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Instructor Inuksuks' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'View Inuksuk: Public view' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Public Inuksuks' }))
    fireEvent.click(screen.getByRole('button', { name: 'View Inuksuk: Public view' }))
    expect(select).toHaveBeenCalledWith(rows[3])
    expect(screen.queryByRole('button', { name: 'Edit Instructor view' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Instructor view options' }))
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Rose window options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(edit).toHaveBeenCalledWith(rows[0])
    expect(select).toHaveBeenCalledTimes(1)
    expect(
      within(screen.getByRole('region', { name: 'My Inuksuks' })).queryByText(/tracery/),
    ).not.toBeInTheDocument()
  })
  it('keeps labels independent, exposes mixed groups and group operations replace row overrides', () => {
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (4)' }))
    fireEvent.click(screen.getByRole('button', { name: 'My Inuksuks markers' }))
    expect(screen.getByRole('button', { name: 'Rose window marker' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rose window marker' }))
    expect(screen.getByRole('button', { name: 'My Inuksuks markers' })).toHaveAttribute(
      'aria-pressed',
      'mixed',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rose window options' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Rose window labels' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Rose window labels' }))
    expect(screen.getByRole('button', { name: 'My Inuksuks options' })).toHaveAttribute(
      'aria-pressed',
      'mixed',
    )
    fireEvent.click(screen.getByRole('button', { name: 'My Inuksuks options' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'My Inuksuks labels' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'My Inuksuks labels' }))
    expect(screen.getByRole('button', { name: 'My Inuksuks options' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'My second marker' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    fireEvent.click(screen.getByRole('button', { name: 'My Inuksuks markers' }))
    expect(screen.getByRole('button', { name: 'My second marker' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
  it('restores focus on Escape and persists label-only state through remount', async () => {
    const first = render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (4)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rose window marker' }))
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Inuksuks (4)' })).toHaveFocus()
    first.unmount()
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (4)' }))
    expect(screen.getByRole('button', { name: 'Rose window marker' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rose window options' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Rose window labels' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close Inuksuks' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })
  it.each([undefined, 'Unable to load Inuksuks.'])('handles empty/error data %s', (error) => {
    render(<Example items={[]} error={error} />)
    fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (0)' }))
    expect(error ? screen.getByRole('alert') : screen.getByText(/No Inuksuks/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
  it('hides empty source groups while keeping populated groups usable', () => {
    render(<Example items={[rows[0]]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (1)' }))
    expect(screen.getByRole('button', { name: 'My Inuksuks markers' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'Instructor Inuksuks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Public Inuksuks' })).not.toBeInTheDocument()
  })
})
