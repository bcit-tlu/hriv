import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import { alpha } from '@mui/material/styles'
import {
  Alert,
  Badge,
  Box,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Slide,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Close,
  CompassCalibration,
  Edit,
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
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.85),
            color: 'text.primary',
            '&:hover': { bgcolor: (theme) => alpha(theme.palette.background.paper, 0.95) },
          }}
        >
          <Badge badgeContent={count} color="primary" max={999}>
            <CompassCalibration />
          </Badge>
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
}: Props) {
  const [expanded, setExpanded] = useState({ mine: true, instructor: true, public: false })
  const closeRef = useRef<HTMLButtonElement>(null)
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
          bottom: 0,
          zIndex: 30,
          width: 380,
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
          {!error && items.length === 0 && (
            <Typography sx={{ p: 2 }} color="text.secondary">
              No Inuksuks on this image yet. Use Add Inuksuk to save a view.
            </Typography>
          )}
          {groups.map(({ source, title }) => {
            const rows = items.filter((item) => item.source === source)
            const markerCount = rows.filter(
              (item) => prefs.visibilityFor(item).markerVisible,
            ).length
            const labelCount = rows.filter((item) => prefs.visibilityFor(item).labelVisible).length
            const allMarkers = rows.length
              ? markerCount === rows.length
              : prefs.groups[source].markerVisible
            const allLabels = rows.length
              ? labelCount === rows.length
              : prefs.groups[source].labelVisible
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
                    aria-expanded={expanded[source]}
                    aria-controls={`${drawerId}-${source}`}
                    aria-label={title}
                    sx={{ px: 0.5, flex: 1, minWidth: 120 }}
                  >
                    {expanded[source] ? (
                      <ExpandLess fontSize="small" />
                    ) : (
                      <ExpandMore fontSize="small" />
                    )}
                    <Typography component="h3" variant="subtitle2">
                      {title} ({rows.length})
                    </Typography>
                  </ListItemButton>
                  <Tooltip
                    title={mixedMarkers ? 'Some markers shown; show all' : 'Toggle all markers'}
                  >
                    <span>
                      <Switch
                        size="small"
                        checked={allMarkers}
                        disabled={!rows.length}
                        onChange={() => prefs.setGroup(source, 'markerVisible', !allMarkers)}
                        slotProps={{
                          input: {
                            'aria-label': `${title} markers`,
                            'aria-describedby': `${drawerId}-${source}-status`,
                          },
                        }}
                      />
                    </span>
                  </Tooltip>
                  <Tooltip
                    title={mixedLabels ? 'Some labels shown; show all' : 'Toggle all labels'}
                  >
                    <span>
                      <IconButton
                        size="small"
                        disabled={!rows.length}
                        aria-label={`${title} labels`}
                        aria-pressed={mixedLabels ? 'mixed' : allLabels}
                        onClick={() => prefs.setGroup(source, 'labelVisible', !allLabels)}
                      >
                        {allLabels || mixedLabels ? (
                          <Visibility fontSize="small" />
                        ) : (
                          <VisibilityOff fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Typography
                    id={`${drawerId}-${source}-status`}
                    variant="caption"
                    color="text.secondary"
                    sx={{ width: '100%', pl: 1 }}
                  >
                    {markerCount}/{rows.length} markers · {labelCount}/{rows.length} labels
                    {mixedMarkers || mixedLabels ? ' · Mixed' : ''}
                  </Typography>
                </Box>
                <Collapse in={expanded[source]} unmountOnExit id={`${drawerId}-${source}`}>
                  <List disablePadding>
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
                              secondary={[
                                item.description,
                                `${item.board_ids.length} Board${item.board_ids.length === 1 ? '' : 's'}`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                              slotProps={{
                                primary: { noWrap: true, title: item.title },
                                secondary: { noWrap: true, title: item.description ?? undefined },
                              }}
                            />
                          </ListItemButton>
                          {item.permissions.can_edit && (
                            <IconButton
                              size="small"
                              aria-label={`Edit ${item.title}`}
                              onClick={() => onEdit(item)}
                            >
                              <Edit fontSize="small" />
                            </IconButton>
                          )}
                          <Switch
                            size="small"
                            checked={visible.markerVisible}
                            onChange={(_, checked) => prefs.setItem(item, 'markerVisible', checked)}
                            slotProps={{ input: { 'aria-label': `${item.title} marker` } }}
                          />
                          <IconButton
                            size="small"
                            aria-label={`${item.title} label`}
                            aria-pressed={visible.labelVisible}
                            onClick={() =>
                              prefs.setItem(item, 'labelVisible', !visible.labelVisible)
                            }
                          >
                            {visible.labelVisible ? (
                              <Visibility fontSize="small" />
                            ) : (
                              <VisibilityOff fontSize="small" />
                            )}
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
      </Paper>
    </Slide>
  )
}
