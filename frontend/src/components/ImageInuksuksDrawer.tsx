import { useRef, useState } from 'react'
import type { RefObject } from 'react'
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
  CompassCalibration,
  Edit,
  Delete,
  MoreVert,
  ExpandLess,
  ExpandMore,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material'
import type { ApiInuksuk, InuksukSource } from '../types'
import type { InuksukVisibilityPrefs } from '../useInuksukVisibilityPrefs'

interface TriggerProps {
  open: boolean
  count: number
  disabled?: boolean
  drawerId: string
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}
export function ImageInuksuksTrigger({
  open,
  count,
  disabled,
  drawerId,
  onOpenChange,
  triggerRef,
}: TriggerProps) {
  return (
    <Tooltip title="Inuksuks" slotProps={{ popper: { disablePortal: true } }}>
      <span>
        <IconButton
          ref={triggerRef}
          data-hriv-canvas-ui
          aria-label={`Inuksuks (${count})`}
          aria-expanded={open}
          aria-controls={drawerId}
          disabled={disabled}
          onClick={() => onOpenChange(!open)}
          sx={{
            width: 48,
            height: 48,
            borderRadius: 0,
            bgcolor: '#0005',
            color: '#fff',
            '&:hover': { bgcolor: '#0005' },
          }}
        >
          <CompassCalibration />
        </IconButton>
      </span>
    </Tooltip>
  )
}
interface Props {
  items: ApiInuksuk[]
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
  drawerId: string
  prefs: InuksukVisibilityPrefs
  selectedId?: number | null
  error?: string | null
  onSelect: (item: ApiInuksuk) => void
  onEdit: (item: ApiInuksuk) => void
  onDelete?: (item: ApiInuksuk) => void
  draftTitle?: string
}
const groups: { source: InuksukSource; title: string }[] = [
  { source: 'mine', title: 'My Inuksuks' },
  { source: 'instructor', title: 'Instructor Inuksuks' },
  { source: 'public', title: 'Public Inuksuks' },
]
export default function ImageInuksuksDrawer({
  items,
  open,
  onOpenChange,
  triggerRef,
  drawerId,
  prefs,
  selectedId,
  error,
  onSelect,
  onEdit,
  onDelete,
  draftTitle,
}: Props) {
  const [menu, setMenu] = useState<{
    anchor: HTMLElement
    item?: ApiInuksuk
    source?: InuksukSource
    title: string
  } | null>(null)
  const [expanded, setExpanded] = useState({ mine: true, instructor: true, public: false })
  const hasDraft = draftTitle !== undefined
  const closeRef = useRef<HTMLButtonElement>(null)
  const menuActions = useRef<PopoverActions>(null)
  const close = () => {
    onOpenChange(false)
    triggerRef.current?.focus()
  }
  return (
    <Slide
      direction="right"
      in={open}
      mountOnEnter
      unmountOnExit
      onEntered={() => closeRef.current?.focus()}
    >
      <Paper
        component="aside"
        id={drawerId}
        aria-labelledby={`${drawerId}-title`}
        elevation={8}
        square
        data-hriv-canvas-ui
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
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
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography component="h2" variant="subtitle1" id={`${drawerId}-title`}>
            Inuksuks ({items.length})
          </Typography>
          <IconButton ref={closeRef} aria-label="Close Inuksuks" onClick={close}>
            <Close />
          </IconButton>
        </Box>
        <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1 }} tabIndex={0}>
          {error && <Alert severity="error">{error}</Alert>}
          {!error && items.length === 0 && draftTitle === undefined && (
            <Typography sx={{ p: 2 }} color="text.secondary">
              No Inuksuks on this image yet. Use Add Inuksuk to save a view.
            </Typography>
          )}
          {groups.map(({ source, title }) => {
            const rows = items.filter((item) => item.source === source)
            const groupExpanded = expanded[source] || (source === 'mine' && hasDraft)
            if (rows.length === 0 && !(source === 'mine' && draftTitle !== undefined)) return null
            const markerCount = rows.filter(
              (item) => prefs.visibilityFor(item).markerVisible,
            ).length
            const labelCount = rows.filter((item) => prefs.visibilityFor(item).labelVisible).length
            const allMarkers = markerCount === rows.length
            const allLabels = labelCount === rows.length
            const mixedMarkers = markerCount > 0 && markerCount < rows.length
            const mixedLabels = labelCount > 0 && labelCount < rows.length
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
                    sx={{ px: 0.5, flex: 1, minWidth: 120 }}
                  >
                    {groupExpanded ? (
                      <ExpandLess fontSize="small" />
                    ) : (
                      <ExpandMore fontSize="small" />
                    )}
                    <Typography component="h3" variant="subtitle2">
                      {title}
                    </Typography>
                  </ListItemButton>
                  <Tooltip
                    title={mixedMarkers ? 'Some markers shown; show all' : 'Toggle all markers'}
                  >
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`${title} markers`}
                        aria-pressed={mixedMarkers ? 'mixed' : allMarkers}
                        onClick={() => prefs.setGroup(source, 'markerVisible', !allMarkers)}
                      >
                        {allMarkers || mixedMarkers ? (
                          <Visibility fontSize="small" />
                        ) : (
                          <VisibilityOff fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip
                    title={mixedLabels ? 'Some labels shown; show all' : 'Toggle all labels'}
                  >
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`${title} options`}
                        aria-pressed={mixedLabels ? 'mixed' : allLabels}
                        aria-haspopup="menu"
                        onClick={(event) => setMenu({ anchor: event.currentTarget, source, title })}
                      >
                        <MoreVert fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                <Collapse in={groupExpanded} unmountOnExit id={`${drawerId}-${source}`}>
                  <List disablePadding>
                    {source === 'mine' && draftTitle !== undefined && (
                      <ListItem>
                        <ListItemText
                          primary={draftTitle || 'New Inuksuk'}
                          slotProps={{ primary: { noWrap: true } }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          Unsaved
                        </Typography>
                      </ListItem>
                    )}
                    {rows.map((item) => {
                      const visible = prefs.visibilityFor(item)
                      return (
                        <ListItem key={item.id} disablePadding sx={{ pr: 1 }}>
                          <ListItemButton
                            selected={item.id === selectedId}
                            onClick={() => onSelect(item)}
                            aria-label={`View Inuksuk: ${item.title}`}
                            sx={{ minWidth: 0, pl: 2, pr: 0.5 }}
                          >
                            <ListItemText
                              primary={item.title}
                              slotProps={{
                                primary: { noWrap: true, title: item.title },
                              }}
                            />
                          </ListItemButton>
                          <IconButton
                            size="small"
                            aria-label={`${item.title} marker`}
                            aria-pressed={visible.markerVisible}
                            onClick={() =>
                              prefs.setItem(item, 'markerVisible', !visible.markerVisible)
                            }
                          >
                            {visible.markerVisible ? (
                              <Visibility fontSize="small" />
                            ) : (
                              <VisibilityOff fontSize="small" />
                            )}
                          </IconButton>
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
          slotProps={{ transition: { onEntered: () => menuActions.current?.updatePosition() } }}
          data-hriv-canvas-ui
          open={!!menu}
          anchorEl={menu?.anchor}
          onClose={() => setMenu(null)}
          container={menu?.anchor.closest('aside')?.parentElement}
        >
          {menu &&
            (() => {
              const rows = items.filter((item) => item.source === menu.source)
              const all = menu.item
                ? prefs.visibilityFor(menu.item).labelVisible
                : rows.every((item) => prefs.visibilityFor(item).labelVisible)
              const mixed =
                !menu.item && !all && rows.some((item) => prefs.visibilityFor(item).labelVisible)
              return (
                <MenuItem
                  aria-label={`${menu.title} labels`}
                  role="menuitemcheckbox"
                  aria-checked={mixed ? 'mixed' : all}
                  onClick={() => {
                    if (menu.item) prefs.setItem(menu.item, 'labelVisible', !all)
                    else if (menu.source) prefs.setGroup(menu.source, 'labelVisible', !all)
                    setMenu(null)
                  }}
                >
                  {all ? 'Hide label' : 'Show label'}
                  {mixed ? ' (Mixed)' : ''}
                </MenuItem>
              )
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
    </Slide>
  )
}
