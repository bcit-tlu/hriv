import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { alpha } from '@mui/material/styles'
import type { PopoverActions } from '@mui/material/Popover'
import {
  Alert,
  Box,
  Button,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Slide,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Close,
  Room,
  Edit,
  Delete,
  ExpandLess,
  ExpandMore,
  MoreVert,
  Visibility,
  VisibilityOff,
  Label,
  LabelOff,
  PushPin,
  PushPinOutlined,
} from '@mui/icons-material'
import type { ApiBoardSummary, ApiMarker, User } from '../types'
import { ownsBoard } from '../boardUtils'
import type { MarkerVisibilityPrefs } from '../useMarkerVisibilityPrefs'

interface TriggerProps {
  open: boolean
  pinned?: boolean
  count: number
  disabled?: boolean
  drawerId: string
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
  tooltipContainer?: HTMLElement | null
}
export function ImageMarkersTrigger({
  open,
  pinned = false,
  count,
  disabled,
  drawerId,
  onOpenChange,
  triggerRef,
  tooltipContainer,
}: TriggerProps) {
  return (
    <Tooltip
      title="Markers"
      slotProps={{
        popper: tooltipContainer ? { container: tooltipContainer } : { disablePortal: true },
      }}
    >
      <span>
        <IconButton
          ref={triggerRef}
          data-hriv-canvas-ui
          aria-label={`Markers (${count})`}
          aria-expanded={open}
          aria-controls={drawerId}
          disabled={disabled}
          onClick={pinned ? undefined : () => onOpenChange(!open)}
          aria-disabled={pinned || undefined}
          tabIndex={pinned ? -1 : undefined}
          sx={{
            width: 48,
            height: 48,
            borderRadius: 0,
            pointerEvents: pinned ? 'none' : undefined,
            bgcolor: (theme) => alpha(theme.palette.common.black, 1 / 3),
            color: 'common.white',
            '&:hover': { bgcolor: (theme) => alpha(theme.palette.common.black, 7 / 15) },
          }}
        >
          <Room />
        </IconButton>
      </span>
    </Tooltip>
  )
}
export interface ImageMarkersListProps {
  items: ApiMarker[]
  /** Boards used to group the rows; `undefined` while the list is loading. */
  boards?: ApiBoardSummary[]
  /** Viewer identity used to split owned/instructor Boards from shared Boards. */
  currentUser?: User | null
  drawerId: string
  prefs: MarkerVisibilityPrefs
  selectedId?: number | null
  focusId?: number | null
  error?: string | null
  onSelect: (item: ApiMarker) => void
  onEdit: (item: ApiMarker) => void
  onDelete?: (item: ApiMarker) => void
  /** Opens the Board dialog for a group heading (same as the Boards page tile). */
  onOpenBoard?: (boardId: number) => void
  draftTitle?: string
}

interface Props extends ImageMarkersListProps {
  embedded?: boolean
  open: boolean
  pinned: boolean
  onPinnedChange: (pinned: boolean) => void
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}

interface DrawerGroup {
  key: string
  title: string
  boardId: number | null
  rows: ApiMarker[]
  draft?: boolean
}
export default function ImageMarkersDrawer({
  embedded = false,
  items,
  boards,
  currentUser = null,
  open,
  pinned,
  onPinnedChange,
  onOpenChange,
  triggerRef,
  drawerId,
  prefs,
  selectedId,
  focusId,
  error,
  onSelect,
  onEdit,
  onDelete,
  onOpenBoard,
  draftTitle,
}: Props) {
  const [menu, setMenu] = useState<{
    anchor: HTMLElement
    item: ApiMarker
  } | null>(null)
  const knownIds = new Set((boards ?? []).map((board) => board.id))
  const instructorOwned = (board: ApiBoardSummary) =>
    board.owner_program_id != null ||
    board.owners.some((owner) => owner.role === 'admin' || owner.role === 'instructor')
  const ownBoards = (boards ?? []).filter((board) => ownsBoard(board, currentUser))
  const instructorBoards = (boards ?? []).filter(
    (board) => !ownsBoard(board, currentUser) && instructorOwned(board),
  )
  const sharedBoards = (boards ?? []).filter(
    (board) => !ownsBoard(board, currentUser) && !instructorOwned(board),
  )
  const boardGroup = (board: ApiBoardSummary): DrawerGroup => ({
    key: `board:${board.id}`,
    title: board.name,
    boardId: board.id,
    rows: items.filter((item) => item.board_ids.includes(board.id)),
  })
  const prominentGroups = [...ownBoards, ...instructorBoards]
    .map(boardGroup)
    .filter((group) => group.rows.length > 0)
  const sharedGroups = sharedBoards.map(boardGroup).filter((group) => group.rows.length > 0)
  const sharedRows = [
    ...new Map(sharedGroups.flatMap((group) => group.rows).map((row) => [row.id, row])).values(),
  ]
  const groups: DrawerGroup[] = [
    ...(draftTitle !== undefined
      ? [{ key: 'unsaved', title: 'Unsaved', boardId: null, rows: [], draft: true }]
      : []),
    ...prominentGroups,
  ]
  const otherGroup: DrawerGroup | null =
    boards !== undefined && items.some((item) => !item.board_ids.some((id) => knownIds.has(id)))
      ? {
          key: 'other',
          title: 'Other',
          boardId: null,
          rows: items.filter((item) => !item.board_ids.some((id) => knownIds.has(id))),
        }
      : null
  const [sharedOpen, setSharedOpen] = useState(false)
  const focusIsShared =
    focusId != null && sharedGroups.some((group) => group.rows.some((row) => row.id === focusId))
  const boardsLoading = boards === undefined && items.length > 0
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuActions = useRef<PopoverActions>(null)
  const focusedId = useRef<number | null>(null)
  // Expand Public & Shared when focus lands on a row inside it — render-phase
  // adjustment so the section is mounted before the scroll/focus effect runs.
  // Only consumes the focus while the drawer is open, matching the effect's
  // old `!open` early return.
  const [seenFocusId, setSeenFocusId] = useState<number | null>(null)
  if (focusId == null) {
    if (seenFocusId != null) setSeenFocusId(null)
  } else if (open && focusIsShared && focusId !== seenFocusId) {
    setSeenFocusId(focusId)
    setSharedOpen(true)
  }
  useEffect(() => {
    if (focusId == null) {
      focusedId.current = null
      return
    }
    if (focusedId.current === focusId || !open) return
    const row = drawerRef.current?.querySelector<HTMLButtonElement>(
      `[data-marker-row="${focusId}"]`,
    )
    if (!row) return
    row.focus()
    row.scrollIntoView?.({ block: 'nearest' })
    focusedId.current = focusId
  }, [focusId, items, boards, open, sharedOpen])
  const visibilityToggles = (rows: ApiMarker[], title: string) => {
    const markerAll = rows.every((item) => prefs.visibilityFor(item).markerVisible)
    const markerSome = rows.some((item) => prefs.visibilityFor(item).markerVisible)
    const labelAll = rows.every((item) => prefs.visibilityFor(item).labelVisible)
    const labelSome = rows.some((item) => prefs.visibilityFor(item).labelVisible)
    return (
      <>
        <Tooltip title={markerAll ? 'Hide markers' : 'Show markers'}>
          <span>
            <IconButton
              size="small"
              aria-label={`${title} markers`}
              aria-pressed={!markerAll && markerSome ? 'mixed' : markerAll}
              onClick={() => prefs.setItems(rows, 'markerVisible', !markerAll)}
            >
              {markerAll ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip
          title={
            !markerSome
              ? 'Labels follow marker visibility'
              : labelAll
                ? 'Hide labels'
                : 'Show labels'
          }
        >
          <span>
            <IconButton
              size="small"
              aria-label={`${title} labels`}
              aria-pressed={markerSome ? (!labelAll && labelSome ? 'mixed' : labelAll) : false}
              disabled={!markerSome}
              onClick={() => prefs.setItems(rows, 'labelVisible', !labelAll)}
            >
              {markerSome && labelAll ? <Label fontSize="small" /> : <LabelOff fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </>
    )
  }
  const renderGroup = (group: DrawerGroup) => {
    const rows = group.rows
    return (
      <Box
        component="section"
        key={group.key}
        aria-label={group.title}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1,
            py: 0.5,
            bgcolor: 'action.hover',
          }}
        >
          {group.boardId != null && onOpenBoard ? (
            <Button
              onClick={() => onOpenBoard(group.boardId as number)}
              aria-label={`Open Board: ${group.title}`}
              sx={{
                p: 0.5,
                minWidth: 0,
                flex: 1,
                textTransform: 'none',
                justifyContent: 'flex-start',
              }}
            >
              <Typography component="h3" variant="body2" noWrap title={group.title}>
                {group.title}
              </Typography>
            </Button>
          ) : (
            <Typography
              component="h3"
              variant="body2"
              noWrap
              title={group.title}
              sx={{ flex: 1, minWidth: 0, px: 0.5 }}
            >
              {group.title}
            </Typography>
          )}
          {rows.length > 0 && visibilityToggles(rows, group.title)}
        </Box>
        <List dense disablePadding>
          {group.draft && (
            <ListItem>
              <ListItemText
                primary={draftTitle || 'New Marker'}
                slotProps={{ primary: { noWrap: true, variant: 'caption' } }}
              />
            </ListItem>
          )}
          {rows.map((item) => {
            const visible = prefs.visibilityFor(item)
            return (
              <ListItem
                key={item.id}
                disablePadding
                sx={{
                  '&:hover': { bgcolor: 'action.hover' },
                  ...(item.id === selectedId && { bgcolor: 'action.selected' }),
                }}
              >
                <ListItemButton
                  data-marker-row={item.id}
                  onClick={() => onSelect(item)}
                  aria-label={`View Marker: ${item.title}${visible.markerVisible ? '' : ' (marker hidden)'}`}
                  aria-pressed={item.id === selectedId}
                  sx={{
                    minWidth: 0,
                    width: '100%',
                    pl: 2,
                    pr: 5,
                    py: 0.5,
                    '&:hover': { bgcolor: 'transparent' },
                  }}
                >
                  <ListItemText
                    primary={item.title}
                    slotProps={{
                      primary: {
                        noWrap: true,
                        variant: 'caption',
                        title: item.title,
                        color: visible.markerVisible ? undefined : 'text.disabled',
                        sx: visible.markerVisible
                          ? undefined
                          : {
                              color: (theme) =>
                                theme.palette.mode === 'light'
                                  ? theme.palette.text.secondary
                                  : theme.palette.text.disabled,
                            },
                      },
                    }}
                  />
                </ListItemButton>
                <Box sx={{ position: 'absolute', right: 8, display: 'flex' }}>
                  <IconButton
                    size="small"
                    aria-label={`${item.title} options`}
                    aria-haspopup="menu"
                    onClick={(event) => setMenu({ anchor: event.currentTarget, item })}
                  >
                    <MoreVert fontSize="small" />
                  </IconButton>
                </Box>
              </ListItem>
            )
          })}
        </List>
      </Box>
    )
  }
  const close = () => {
    setMenu(null)
    onOpenChange(false)
    triggerRef.current?.focus()
  }
  useEffect(() => {
    if (!open || pinned || embedded) return
    const onPress = (event: Event) => {
      const target = event.target
      if (
        !(target instanceof Node) ||
        drawerRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return
      setMenu(null)
      onOpenChange(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    const events = ['pointerdown', 'mousedown', 'touchstart', 'click'] as const
    events.forEach((name) => document.addEventListener(name, onPress, true))
    window.addEventListener('keydown', onKey)
    return () => {
      events.forEach((name) => document.removeEventListener(name, onPress, true))
      window.removeEventListener('keydown', onKey)
    }
  }, [open, pinned, embedded, onOpenChange, triggerRef])
  const content = (
    <Paper
      ref={drawerRef}
      component={embedded ? 'div' : 'aside'}
      id={drawerId}
      aria-label={embedded ? undefined : 'Markers'}
      elevation={embedded ? 0 : 8}
      square
      data-hriv-canvas-ui
      onKeyDown={(e: ReactKeyboardEvent<HTMLElement>) => {
        if (e.key === 'Escape' && !pinned) {
          e.stopPropagation()
          close()
        }
      }}
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 56,
        zIndex: 30,
        width: 320,
        maxWidth: 'calc(100% - 48px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...(embedded
          ? {
              position: 'relative',
              width: '100%',
              maxWidth: 'none',
              top: 'auto',
              left: 'auto',
              bottom: 'auto',
              height: '100%',
              bgcolor: 'transparent',
              backgroundImage: 'none',
            }
          : {}),
      }}
    >
      {!embedded && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            px: 2,
            py: 1,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex' }}>
            <IconButton
              aria-label={pinned ? 'Unpin Markers' : 'Pin Markers'}
              aria-pressed={pinned}
              onClick={() => onPinnedChange(!pinned)}
              sx={{ bgcolor: pinned ? 'action.selected' : undefined }}
            >
              {pinned ? <PushPin /> : <PushPinOutlined />}
            </IconButton>
            {!pinned && (
              <IconButton ref={closeRef} aria-label="Close Markers" onClick={close}>
                <Close />
              </IconButton>
            )}
          </Box>
        </Box>
      )}
      <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1 }} tabIndex={0}>
        {error && <Alert severity="error">{error}</Alert>}
        {!error && items.length === 0 && draftTitle === undefined && (
          <Typography variant="caption" component="p" sx={{ p: 1.5 }} color="text.secondary">
            No Markers on this image yet. Use Add Marker{' '}
            <Box
              component="img"
              src="/openseadragon-svg-icons/marker_rest.svg"
              alt=""
              aria-hidden
              sx={{ width: 24, height: 24, verticalAlign: 'middle' }}
            />{' '}
            in the image toolbar to save a view.
          </Typography>
        )}
        {boardsLoading && (
          <Typography variant="caption" component="p" sx={{ p: 1.5 }} color="text.secondary">
            Loading Boards…
          </Typography>
        )}
        {groups.map(renderGroup)}
        {sharedGroups.length > 0 && (
          <Box
            component="section"
            aria-label="Public & Shared"
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                px: 1,
                py: 0.5,
                bgcolor: 'action.hover',
              }}
            >
              <Button
                onClick={() => setSharedOpen((value) => !value)}
                aria-expanded={sharedOpen}
                aria-controls={`${drawerId}-shared`}
                sx={{
                  p: 0.5,
                  minWidth: 0,
                  flex: 1,
                  textTransform: 'none',
                  justifyContent: 'flex-start',
                }}
              >
                {sharedOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                <Typography component="h3" variant="body2" noWrap title="Public & Shared">
                  Public &amp; Shared
                </Typography>
              </Button>
              {visibilityToggles(sharedRows, 'Public & Shared')}
            </Box>
            <Collapse in={sharedOpen} unmountOnExit id={`${drawerId}-shared`}>
              {sharedGroups.map(renderGroup)}
            </Collapse>
          </Box>
        )}
        {otherGroup && renderGroup(otherGroup)}
      </Box>
      <Menu
        action={menuActions}
        slotProps={{
          paper: { ref: menuRef },
          transition: { onEntered: () => menuActions.current?.updatePosition() },
        }}
        data-hriv-canvas-ui
        open={!!menu}
        anchorEl={menu?.anchor}
        onClose={() => setMenu(null)}
        container={() => drawerRef.current?.parentElement ?? null}
      >
        {menu &&
          (['markerVisible', 'labelVisible'] as const).map((field) => {
            const visible = prefs.visibilityFor(menu.item)
            const all = visible[field]
            const marker = field === 'markerVisible'
            return (
              <MenuItem
                key={field}
                aria-label={`${menu.item.title} ${marker ? 'marker' : 'labels'}`}
                role="menuitemcheckbox"
                aria-checked={all}
                disabled={!marker && !visible.markerVisible}
                onClick={() => {
                  prefs.setItem(menu.item, field, !all)
                  setMenu(null)
                }}
              >
                {marker ? (
                  all ? (
                    <Visibility fontSize="small" sx={{ mr: 1 }} />
                  ) : (
                    <VisibilityOff fontSize="small" sx={{ mr: 1 }} />
                  )
                ) : all ? (
                  <LabelOff fontSize="small" sx={{ mr: 1 }} />
                ) : (
                  <Label fontSize="small" sx={{ mr: 1 }} />
                )}
                {all ? 'Hide' : 'Show'} {marker ? 'marker' : 'label'}
              </MenuItem>
            )
          })}
        {menu?.item.permissions.can_edit && (
          <MenuItem
            onClick={() => {
              onEdit(menu.item)
              setMenu(null)
            }}
          >
            <Edit fontSize="small" sx={{ mr: 1 }} />
            Edit
          </MenuItem>
        )}
        {menu?.item.permissions.can_delete && (
          <MenuItem
            onClick={() => {
              ;(onDelete ?? onEdit)(menu.item)
              setMenu(null)
            }}
          >
            <Delete fontSize="small" sx={{ mr: 1 }} />
            Delete
          </MenuItem>
        )}
      </Menu>
    </Paper>
  )
  return embedded ? (
    content
  ) : (
    <Slide
      direction="right"
      in={open}
      mountOnEnter
      unmountOnExit
      onEntered={() => {
        const row = drawerRef.current?.querySelector<HTMLElement>(`[data-marker-row="${focusId}"]`)
        if (row && row === row.ownerDocument.activeElement) return
        closeRef.current?.focus()
      }}
    >
      {content}
    </Slide>
  )
}

export function ImageMarkersList(props: ImageMarkersListProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <ImageMarkersDrawer
      {...props}
      embedded
      open
      pinned
      onPinnedChange={() => {}}
      onOpenChange={() => {}}
      triggerRef={triggerRef}
    />
  )
}
