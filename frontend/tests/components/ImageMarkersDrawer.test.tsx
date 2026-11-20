import { useRef, useState } from 'react'
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { alpha, createTheme, ThemeProvider } from '@mui/material/styles'
import Drawer, { ImageMarkersTrigger } from '../../src/components/ImageMarkersDrawer'
import { useMarkerVisibilityPrefs } from '../../src/useMarkerVisibilityPrefs'
import { MARKER_FIXTURE } from '../../src/components/markerFixtures'
import { BOARD_USER, BOARDS_FIXTURES } from '../../src/components/boardsFixtures'
import type { ApiBoard, ApiMarker, User } from '../../src/types'

const boards = [BOARDS_FIXTURES[0], BOARDS_FIXTURES[2]]
// Board 1 'Architecture inspiration' (id 1), Board 2 'Shared discoveries' (id 2).
const rows: ApiMarker[] = [
  MARKER_FIXTURE,
  { ...MARKER_FIXTURE, id: 8, title: 'My second', source: 'mine' },
  {
    ...MARKER_FIXTURE,
    id: 9,
    title: 'Instructor view',
    source: 'instructor',
    board_ids: [2],
    permissions: { can_edit: false, can_delete: false },
  },
  {
    ...MARKER_FIXTURE,
    id: 10,
    title: 'Public view',
    source: 'public',
    board_ids: [2],
    permissions: { can_edit: false, can_delete: false },
  },
]
// A public Board owned by another student — lands in the collapsed Public & Shared tier.
const classmateBoard: ApiBoard = {
  ...BOARDS_FIXTURES[2],
  id: 4,
  name: 'Classmate picks',
  visibility: 'public',
  owners: [{ user_id: 42, program_id: null, name: 'Sam', role: 'student' }],
}
const classmateView: ApiMarker = {
  ...MARKER_FIXTURE,
  id: 13,
  title: 'Classmate view',
  source: 'public',
  board_ids: [4],
  permissions: { can_edit: false, can_delete: false },
}
function Example({
  items = rows,
  boards: boardsProp = boards,
  boardsPending = false,
  currentUser = BOARD_USER,
  onOpenBoard = vi.fn(),
  onSelect = vi.fn(),
  onEdit = vi.fn(),
  error,
  focusId,
  selectedId,
  draftTitle,
}: {
  items?: ApiMarker[]
  boards?: typeof boards
  boardsPending?: boolean
  currentUser?: User | null
  onOpenBoard?: (boardId: number) => void
  onSelect?: (item: ApiMarker) => void
  onEdit?: (item: ApiMarker) => void
  error?: string
  focusId?: number
  selectedId?: number
  draftTitle?: string
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const prefs = useMarkerVisibilityPrefs(9)
  return (
    <div style={{ position: 'relative', width: 600, height: 600 }}>
      <ImageMarkersTrigger
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
        boards={boardsPending ? undefined : boardsProp}
        currentUser={currentUser}
        prefs={prefs}
        error={error}
        focusId={focusId}
        selectedId={selectedId}
        onSelect={onSelect}
        onEdit={onEdit}
        onOpenBoard={onOpenBoard}
        draftTitle={draftTitle}
      />
    </div>
  )
}
beforeEach(() => localStorage.clear())
function openOptions(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `${name} options` }))
}
function toggleMarker(name: string, group = false) {
  if (group) {
    fireEvent.click(screen.getByRole('button', { name: `${name} markers` }))
    return
  }
  openOptions(name)
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: `${name} marker` }))
}
describe('ImageMarkersDrawer', () => {
  it.each([undefined, MARKER_FIXTURE.id])(
    'preserves the requested row focus after opening an unpinned drawer, focusId=%s',
    async (focusId) => {
      vi.useFakeTimers()
      try {
        const { rerender } = render(<Example />)
        rerender(<Example focusId={focusId} selectedId={focusId} />)
        fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
        const target = screen.getByRole('button', {
          name: focusId == null ? 'Close Markers' : 'View Marker: Rose window',
        })
        if (focusId != null) expect(target).toHaveFocus()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000)
        })
        expect(target).toHaveFocus()
      } finally {
        vi.useRealTimers()
      }
    },
  )
  it.each([undefined, 'Unable to load Markers'])(
    'keeps focus when a requested row is unavailable, error=%s',
    (error) => {
      const { rerender } = render(<Example items={[]} error={error} />)
      fireEvent.click(screen.getByRole('button', { name: 'Markers (0)' }))
      const close = screen.getByRole('button', { name: 'Close Markers' })
      close.focus()
      rerender(<Example items={[]} error={error} focusId={99} />)
      expect(close).toHaveFocus()
    },
  )
  it('focuses and scrolls the requested saved row without re-focusing on reload', async () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    })
    try {
      const { rerender } = render(<Example />)
      fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
      const created = { ...MARKER_FIXTURE, id: 99, title: 'New saved view' }
      rerender(<Example items={[...rows, created]} focusId={99} selectedId={99} />)
      const row = await screen.findByRole('button', { name: 'View Marker: New saved view' })
      await waitFor(() => expect(row).toHaveFocus())
      expect(row).toHaveAttribute('aria-pressed', 'true')
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      const group = screen.getByRole('button', {
        name: 'Open Board: Architecture inspiration',
      })
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
      const trigger = screen.getByRole('button', { name: 'Markers (4)' })
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
    const trigger = screen.getByRole('button', { name: 'Markers (4)' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Pin Markers' }))
    expect(screen.getByRole('button', { name: 'Unpin Markers' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'Close Markers' })).toBeNull()
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-disabled', 'true')
    openOptions('Rose window')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Rose window marker' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Markers' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
  it.each(['Architecture inspiration', 'Rose window'])(
    'removes the modal backdrop after changing %s labels',
    async (name) => {
      render(<Example />)
      fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
      if (name === 'Architecture inspiration') {
        fireEvent.click(screen.getByRole('button', { name: 'Architecture inspiration labels' }))
        expect(document.querySelector('.MuiModal-root')).toBeNull()
        toggleMarker('Architecture inspiration', true)
        expect(
          screen.getByRole('button', { name: 'Architecture inspiration markers' }),
        ).toHaveAttribute('aria-pressed', 'false')
        return
      }
      fireEvent.click(screen.getByRole('button', { name: `${name} options` }))
      await waitFor(() => expect(screen.getByRole('menu')).toBeVisible())
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: `${name} labels` }))
      await waitFor(() => expect(document.querySelector('.MuiModal-root')).toBeNull())
      toggleMarker('Architecture inspiration', true)
      expect(
        screen.getByRole('button', { name: 'Architecture inspiration markers' }),
      ).toHaveAttribute('aria-pressed', 'false')
    },
  )
  it.each(['light', 'dark'] as const)('uses %s theme colors for the trigger', (mode) => {
    const theme = createTheme({ palette: { mode, common: { black: '#102030', white: '#f0e0d0' } } })
    render(
      <ThemeProvider theme={theme}>
        <Example />
      </ThemeProvider>,
    )
    expect(screen.getByRole('button', { name: 'Markers (4)' })).toHaveStyle({
      backgroundColor: alpha(theme.palette.common.black, 1 / 3),
      color: theme.palette.common.white,
    })
  })
  it('groups rows under their Boards, links headings to the Board dialog and restricts editing', () => {
    const select = vi.fn()
    const edit = vi.fn()
    const openBoard = vi.fn()
    render(<Example onSelect={select} onEdit={edit} onOpenBoard={openBoard} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
    expect(screen.queryByRole('heading', { name: /^Markers \(/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Architecture inspiration' })).toHaveClass(
      'MuiTypography-body2',
    )
    expect(screen.getByRole('heading', { name: 'Shared discoveries' })).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: 'Architecture inspiration' })).getAllByRole(
        'button',
        { name: /^View Marker:/ },
      ),
    ).toHaveLength(2)
    expect(
      within(screen.getByRole('region', { name: 'Shared discoveries' })).getAllByRole('button', {
        name: /^View Marker:/,
      }),
    ).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Open Board: Architecture inspiration' }))
    expect(openBoard).toHaveBeenCalledWith(1)
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'View Marker: Public view (marker hidden)' }),
    )
    expect(select).toHaveBeenCalledWith(rows[3])
    fireEvent.click(screen.getByRole('button', { name: 'Instructor view options' }))
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Rose window options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(edit).toHaveBeenCalledWith(rows[0])
    expect(select).toHaveBeenCalledTimes(1)
  })
  it('lists a Marker under every associated Board and falls back to Other for unknown Boards', () => {
    const item = {
      ...MARKER_FIXTURE,
      id: 11,
      title: 'Shared view',
      board_ids: [1, 2],
    }
    const orphan = { ...MARKER_FIXTURE, id: 12, title: 'Orphan view', board_ids: [99] }
    render(<Example items={[item, orphan]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (2)' }))
    expect(
      within(screen.getByRole('region', { name: 'Architecture inspiration' })).getByRole('button', {
        name: 'View Marker: Shared view',
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Shared discoveries' })).getByRole('button', {
        name: 'View Marker: Shared view',
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Other' })).getByRole('button', {
        name: 'View Marker: Orphan view',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Board: Other' })).not.toBeInTheDocument()
  })
  it('shows a Boards loading row while the board list is pending', () => {
    render(<Example boardsPending />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
    expect(screen.getByText('Loading Boards…')).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
  it('groups the unsaved draft under an Unsaved heading', () => {
    render(<Example draftTitle="Window study" />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
    const group = screen.getByRole('region', { name: 'Unsaved' })
    expect(within(group).getByText('Window study')).toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: /^View Marker:/ })).not.toBeInTheDocument()
  })
  it('keeps labels independent, exposes mixed groups and group operations set row overrides', () => {
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
    const groupMarkers = screen.getByRole('button', {
      name: 'Architecture inspiration markers',
    })
    const groupLabels = screen.getByRole('button', {
      name: 'Architecture inspiration labels',
    })
    expect(groupMarkers).toHaveAttribute('aria-pressed', 'true')
    expect(groupLabels).toHaveAttribute('aria-pressed', 'true')
    toggleMarker('Architecture inspiration', true)
    const hidden = screen.getByRole('button', { name: 'View Marker: Rose window (marker hidden)' })
    expect(within(hidden).getByText('Rose window')).toHaveStyle({
      color: createTheme().palette.text.secondary,
    })
    expect(groupMarkers).toHaveAttribute('aria-pressed', 'false')
    expect(groupLabels).toBeDisabled()
    toggleMarker('Rose window')
    expect(groupMarkers).toHaveAttribute('aria-pressed', 'mixed')
    expect(groupLabels).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Rose window options' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Rose window labels' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(
      within(screen.getByRole('menuitemcheckbox', { name: 'Rose window labels' })).getByTestId(
        'LabelOffIcon',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Rose window labels' }))
    expect(groupLabels).toHaveAttribute('aria-pressed', 'mixed')
    expect(within(groupLabels).getByTestId('LabelOffIcon')).toBeInTheDocument()
    fireEvent.click(groupLabels)
    expect(groupLabels).toHaveAttribute('aria-pressed', 'true')
    expect(within(groupLabels).getByTestId('LabelIcon')).toBeInTheDocument()
    openOptions('My second')
    expect(screen.getByRole('menuitemcheckbox', { name: 'My second marker' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    toggleMarker('Architecture inspiration', true)
    openOptions('My second')
    expect(screen.getByRole('menuitemcheckbox', { name: 'My second marker' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
  it('toggles a whole board group from its heading icons without opening a menu', () => {
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
    expect(
      screen.queryByRole('button', { name: 'Architecture inspiration options' }),
    ).not.toBeInTheDocument()
    const groupMarkers = screen.getByRole('button', {
      name: 'Architecture inspiration markers',
    })
    const groupLabels = screen.getByRole('button', {
      name: 'Architecture inspiration labels',
    })
    fireEvent.click(groupMarkers)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(groupMarkers).toHaveAttribute('aria-pressed', 'false')
    expect(groupLabels).toBeDisabled()
    expect(groupLabels).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(groupMarkers)
    expect(groupMarkers).toHaveAttribute('aria-pressed', 'true')
    expect(groupLabels).toBeEnabled()
    fireEvent.click(groupLabels)
    expect(groupLabels).toHaveAttribute('aria-pressed', 'false')
  })
  it('restores focus on Escape and persists label-only state through remount', async () => {
    const first = render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
    toggleMarker('Rose window')
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Markers (4)' })).toHaveFocus()
    first.unmount()
    render(<Example />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (4)' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Close Markers' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })
  it.each([undefined, 'Unable to load Markers.'])('handles empty/error data %s', (error) => {
    render(<Example items={[]} error={error} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (0)' }))
    expect(error ? screen.getByRole('alert') : screen.getByText(/No Markers/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
  it('hides Boards without rows while keeping populated groups usable', () => {
    render(<Example items={[rows[0]]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (1)' }))
    expect(screen.getByRole('button', { name: 'Architecture inspiration markers' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Architecture inspiration labels' })).toBeEnabled()
    expect(screen.queryByRole('region', { name: 'Shared discoveries' })).not.toBeInTheDocument()
  })
  it('orders groups Unsaved, your Boards, instructor Boards, Public & Shared, then Other', () => {
    const orphan = { ...MARKER_FIXTURE, id: 14, title: 'Orphan view', board_ids: [99] }
    render(
      <Example
        items={[...rows, classmateView, orphan]}
        boards={[...boards, classmateBoard]}
        draftTitle="Window study"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Markers (6)' }))
    expect(
      screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')),
    ).toEqual([
      'Unsaved',
      'Architecture inspiration',
      'Shared discoveries',
      'Public & Shared',
      'Other',
    ])
  })
  it('keeps classmate Boards behind a collapsed Public & Shared section with hidden markers', () => {
    render(<Example items={[...rows, classmateView]} boards={[...boards, classmateBoard]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (5)' }))
    const section = screen.getByRole('region', { name: 'Public & Shared' })
    expect(screen.queryByRole('region', { name: 'Classmate picks' })).not.toBeInTheDocument()
    expect(
      within(section).getByRole('button', { name: 'Public & Shared markers' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(within(section).getByRole('button', { name: 'Public & Shared labels' })).toBeDisabled()
    fireEvent.click(within(section).getByRole('button', { name: 'Public & Shared' }))
    const boardGroup = screen.getByRole('region', { name: 'Classmate picks' })
    expect(
      within(boardGroup).getByRole('button', {
        name: 'View Marker: Classmate view (marker hidden)',
      }),
    ).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'Public & Shared markers' }))
    expect(
      within(boardGroup).getByRole('button', { name: 'View Marker: Classmate view' }),
    ).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'Public & Shared markers' }))
    expect(
      within(boardGroup).getByRole('button', {
        name: 'View Marker: Classmate view (marker hidden)',
      }),
    ).toBeInTheDocument()
  })
  it('lists a Marker on one of your Boards and a shared Board under both headings', () => {
    const dual = { ...MARKER_FIXTURE, id: 15, title: 'Cross-listed', board_ids: [1, 4] }
    render(<Example items={[dual]} boards={[...boards, classmateBoard]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (1)' }))
    expect(
      within(screen.getByRole('region', { name: 'Architecture inspiration' })).getByRole('button', {
        name: 'View Marker: Cross-listed',
      }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Public & Shared' }))
    expect(
      within(screen.getByRole('region', { name: 'Classmate picks' })).getByRole('button', {
        name: 'View Marker: Cross-listed',
      }),
    ).toBeInTheDocument()
  })
  it('expands the shared section to focus a requested row inside it', async () => {
    const { rerender } = render(<Example items={[classmateView]} boards={[classmateBoard]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Markers (1)' }))
    rerender(
      <Example items={[classmateView]} boards={[classmateBoard]} focusId={13} selectedId={13} />,
    )
    const row = await screen.findByRole('button', {
      name: 'View Marker: Classmate view (marker hidden)',
    })
    await waitFor(() => expect(row).toHaveFocus())
    expect(row).toHaveAttribute('aria-pressed', 'true')
  })
})
