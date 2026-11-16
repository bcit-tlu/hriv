import { useRef, useState } from 'react'
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { alpha, createTheme, ThemeProvider } from '@mui/material/styles'
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
  focusId,
  selectedId,
}: {
  items?: ApiInuksuk[]
  onSelect?: (item: ApiInuksuk) => void
  onEdit?: (item: ApiInuksuk) => void
  error?: string
  focusId?: number
  selectedId?: number
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const prefs = useInuksukVisibilityPrefs(9)
  return (
    <div style={{ position: 'relative', width: 600, height: 600 }}>
      <ImageInuksuksTrigger
        open={open}
        pinned={pinned}
        count={items.length}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        drawerId="drawer"
      />
      <Drawer
        drawerId="drawer"
        open={open}
        pinned={pinned}
        onPinnedChange={setPinned}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        items={items}
        prefs={prefs}
        error={error}
        focusId={focusId}
        selectedId={selectedId}
        onSelect={onSelect}
        onEdit={onEdit}
      />
    </div>
  )
}
beforeEach(() => localStorage.clear())
function openOptions(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `${name} options` }))
}
function toggleMarker(name: string, group = false) {
  openOptions(name)
  fireEvent.click(
    screen.getByRole('menuitemcheckbox', { name: `${name} ${group ? 'markers' : 'marker'}` }),
  )
}
describe('ImageInuksuksDrawer', () => {
  it.each([undefined, 'Unable to load Inuksuks'])(
    'keeps focus when a requested row is unavailable, error=%s',
    (error) => {
      const { rerender } = render(<Example items={[]} error={error} />)
      fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (0)' }))
      const close = screen.getByRole('button', { name: 'Close Inuksuks' })
      close.focus()
      rerender(<Example items={[]} error={error} focusId={99} />)
      expect(close).toHaveFocus()
    },
  )
  it('expands the requested group, focuses and scrolls its saved row without re-focusing on reload', async () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    })
    try {
      const { rerender } = render(<Example />)
      fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (4)' }))
      fireEvent.click(screen.getByRole('button', { name: 'My Inuksuks', exact: true }))
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'View Inuksuk: Rose window' })).toBeNull(),
      )
      const created = { ...INUKSUK_FIXTURE, id: 99, title: 'New saved view' }
      rerender(<Example items={[...rows, created]} focusId={99} selectedId={99} />)
      const row = await screen.findByRole('button', { name: 'View Inuksuk: New saved view' })
      await waitFor(() => expect(row).toHaveFocus())
      expect(row).toHaveAttribute('aria-pressed', 'true')
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      const group = screen.getByRole('button', { name: 'My Inuksuks', exact: true })
      group.focus()
      rerender(<Example items={[...rows, created]} focusId={99} selectedId={99} />)
      expect(group).toHaveFocus()
      expect(scroll).toHaveBeenCalledTimes(1)
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
  it.each(['pointerDown', 'mouseDown', 'touchStart', 'click'] as const)(
    'closes immediately on outside %s but ignores its menu portal',
    async (event) => {
      render(<Example />)
      const trigger = screen.getByRole('button', { name: 'Inuksuks (4)' })
      fireEvent.click(trigger)
      openOptions('Rose window')
      fireEvent[event](screen.getByRole('menuitemcheckbox', { name: 'Rose window marker' }))
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      fireEvent[event](document.body)
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await waitFor(() => expect(document.querySelector('.MuiModal-root')).toBeNull())
    },
  )
  it('pins as page furniture, ignores outside presses and Escape, and stays open when unpinned', () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Inuksuks (4)' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Pin Inuksuks' }))
    expect(screen.getByRole('button', { name: 'Unpin Inuksuks' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'Close Inuksuks' })).toBeNull()
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-disabled', 'true')
    openOptions('Rose window')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Rose window marker' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Inuksuks' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
  it.each(['My Inuksuks', 'Rose window'])(
    'removes the modal backdrop after changing %s labels',
    async (name) => {
      render(<Example />)
      fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (4)' }))
      fireEvent.click(screen.getByRole('button', { name: `${name} options` }))
      await waitFor(() => expect(screen.getByRole('menu')).toBeVisible())
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: `${name} labels` }))
      await waitFor(() => expect(document.querySelector('.MuiModal-root')).toBeNull())
      toggleMarker('My Inuksuks', true)
      openOptions('My Inuksuks')
      expect(screen.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' })).toHaveAttribute(
        'aria-checked',
        'false',
      )
    },
  )
  it.each(['light', 'dark'] as const)('uses %s theme colors for the trigger', (mode) => {
    const theme = createTheme({ palette: { mode, common: { black: '#102030', white: '#f0e0d0' } } })
    render(
      <ThemeProvider theme={theme}>
        <Example />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button', { name: 'Inuksuks (4)' })).toHaveStyle({
      backgroundColor: alpha(theme.palette.common.black, 1 / 3),
      color: theme.palette.common.white,
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
    toggleMarker('My Inuksuks', true)
    const hidden = screen.getByRole('button', { name: 'View Inuksuk: Rose window (marker hidden)' })
    expect(within(hidden).getByText('Rose window')).toHaveStyle({
      color: createTheme().palette.text.secondary,
    })
    toggleMarker('Rose window')
    openOptions('My Inuksuks')
    expect(screen.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )
    expect(screen.getByRole('menuitemcheckbox', { name: 'My Inuksuks markers' })).toHaveTextContent(
      'Show markers (Mixed)',
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Rose window options' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Rose window labels' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Rose window labels' }))
    fireEvent.click(screen.getByRole('button', { name: 'My Inuksuks options' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'My Inuksuks labels' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'My Inuksuks labels' }))
    openOptions('My Inuksuks')
    expect(screen.getByRole('menuitemcheckbox', { name: 'My Inuksuks labels' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    openOptions('My second')
    expect(screen.getByRole('menuitemcheckbox', { name: 'My second marker' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    toggleMarker('My Inuksuks', true)
    openOptions('My second')
    expect(screen.getByRole('menuitemcheckbox', { name: 'My second marker' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
  it('restores focus on Escape and persists label-only state through remount', async () => {
    const first = render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (4)' }))
    toggleMarker('Rose window')
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Inuksuks (4)' })).toHaveFocus()
    first.unmount()
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Inuksuks (4)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rose window options' }))
    const menu = screen.getByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitemcheckbox')
        .map((item) => item.textContent),
    ).toEqual(['Show marker', 'Hide label'])
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Rose window marker' }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Edit', 'Delete'])
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
    expect(screen.getByRole('button', { name: 'My Inuksuks options' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'Instructor Inuksuks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Public Inuksuks' })).not.toBeInTheDocument()
  })
})
