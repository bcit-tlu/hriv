import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { alpha } from '@mui/material/styles'
import type { PopoverActions } from '@mui/material/Popover'
import {
  Alert,
  Box,
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
  MoreVert,
  ExpandLess,
  ExpandMore,
  Visibility,
  VisibilityOff,
  Label,
  LabelOff,
  PushPin,
  PushPinOutlined,
} from '@mui/icons-material'
import type { ApiMarker, MarkerSource } from '../types'
import type { MarkerVisibilityPrefs } from '../useMarkerVisibilityPrefs'

interface TriggerProps {
  open: boolean
  pinned?: boolean
  count: number
  disabled?: boolean
  drawerId: string
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}
export function ImageMarkersTrigger({
  open,
  pinned = false,
  count,
  disabled,
  drawerId,
  onOpenChange,
  triggerRef,
}: TriggerProps) {
  return (
    <Tooltip title="Markers" slotProps={{ popper: { disablePortal: true } }}>
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
  drawerId: string
  prefs: MarkerVisibilityPrefs
  selectedId?: number | null
  focusId?: number | null
  error?: string | null
  onSelect: (item: ApiMarker) => void
  onEdit: (item: ApiMarker) => void
  onDelete?: (item: ApiMarker) => void
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

const groups: { source: MarkerSource; title: string }[] = [
  { source: 'mine', title: 'My Markers' },
  { source: 'instructor', title: 'Instructor Markers' },
  { source: 'public', title: 'Public Markers' },
]
export default function ImageMarkersDrawer({
  embedded = false,
  items,
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
  draftTitle,
}: Props) {
  const [menu, setMenu] = useState<{
    anchor: HTMLElement
    item?: ApiMarker
    source?: MarkerSource
    title: string
  } | null>(null)
  const [expanded, setExpanded] = useState({ mine: true, instructor: true, public: false })
  const [focusRequest, setFocusRequest] = useState(focusId)
  if (focusId !== focusRequest) {
    setFocusRequest(focusId)
    const source = items.find((item) => item.id === focusId)?.source
    if (source) setExpanded((value) => ({ ...value, [source]: true }))
  }
  const hasDraft = draftTitle !== undefined
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuActions = useRef<PopoverActions>(null)
  const focusedId = useRef<number | null>(null)
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
  }, [focusId, items, expanded, open])
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
            No Markers on this image yet. Use Add Marker to save a view.
          </Typography>
        )}
        {groups.map(({ source, title }) => {
          const rows = items.filter((item) => item.source === source)
          const groupExpanded = expanded[source] || (source === 'mine' && hasDraft)
          if (rows.length === 0 && !(source === 'mine' && draftTitle !== undefined)) return null
          return (
            <Box
              component="section"
              key={source}
              aria-label={title}
              sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  px: 1,
                  py: 0.5,
                  bgcolor: 'action.hover',
                }}
              >
                <ListItemButton
                  onClick={() => setExpanded((value) => ({ ...value, [source]: !value[source] }))}
                  aria-expanded={groupExpanded}
                  aria-controls={`${drawerId}-${source}`}
                  aria-label={title}
                  aria-describedby={`${drawerId}-${source}-count`}
                  dense
                  sx={{ px: 0.5, py: 0.5, flex: 1, minWidth: 120 }}
                >
                  {groupExpanded ? (
                    <ExpandLess fontSize="small" />
                  ) : (
                    <ExpandMore fontSize="small" />
                  )}
                  <Typography component="h3" variant="body2">
                    {title}{' '}
                    <Box
                      component="span"
                      id={`${drawerId}-${source}-count`}
                      sx={{ color: 'text.secondary' }}
                    >
                      ({rows.length})
                    </Box>
                  </Typography>
                </ListItemButton>
                <Tooltip title="Marker options">
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`${title} options`}
                      aria-haspopup="menu"
                      onClick={(event) => setMenu({ anchor: event.currentTarget, source, title })}
                    >
                      <MoreVert fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
              <Collapse in={groupExpanded} unmountOnExit id={`${drawerId}-${source}`}>
                <List dense disablePadding>
                  {source === 'mine' && draftTitle !== undefined && (
                    <ListItem>
                      <ListItemText
                        primary={draftTitle || 'New Marker'}
                        slotProps={{ primary: { noWrap: true, variant: 'caption' } }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        Unsaved
                      </Typography>
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
                            onClick={(event) =>
                              setMenu({ anchor: event.currentTarget, item, title: item.title })
                            }
                          >
                            <MoreVert fontSize="small" />
                          </IconButton>
                        </Box>
                      </ListItem>
                    )
                  })}
                </List>
              </Collapse>
            </Box>
          )
        })}
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
          (() => {
            const rows = items.filter((item) => item.source === menu.source)
            return (['markerVisible', 'labelVisible'] as const).map((field) => {
              const all = menu.item
                ? prefs.visibilityFor(menu.item)[field]
                : rows.every((item) => prefs.visibilityFor(item)[field])
              const mixed =
                !menu.item && !all && rows.some((item) => prefs.visibilityFor(item)[field])
              const marker = field === 'markerVisible'
              const label = marker
                ? menu.item
                  ? 'marker'
                  : 'markers'
                : menu.item
                  ? 'label'
                  : 'labels'
              return (
                <MenuItem
                  key={field}
                  aria-label={`${menu.title} ${marker ? (menu.item ? 'marker' : 'markers') : 'labels'}`}
                  role="menuitemcheckbox"
                  aria-checked={mixed ? 'mixed' : all}
                  onClick={() => {
                    if (menu.item) prefs.setItem(menu.item, field, !all)
                    else if (menu.source) prefs.setGroup(menu.source, field, !all)
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
                  {all ? 'Hide' : 'Show'} {label}
                  {mixed ? ' (Mixed)' : ''}
                </MenuItem>
              )
            })
          })()}
        {menu?.item?.permissions.can_edit && (
          <MenuItem
            onClick={() => {
              onEdit(menu.item!)
              setMenu(null)
            }}
          >
            <Edit fontSize="small" sx={{ mr: 1 }} />
            Edit
          </MenuItem>
        )}
        {menu?.item?.permissions.can_delete && (
          <MenuItem
            onClick={() => {
              ;(onDelete ?? onEdit)(menu.item!)
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
