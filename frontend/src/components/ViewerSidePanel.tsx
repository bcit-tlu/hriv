import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Box,
  Button,
  IconButton,
  Paper,
  SvgIcon,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { InfoOutlined, Link, Room } from '@mui/icons-material'
import { ViewerControlHints } from './ImageDetailsDrawer'
import type { ViewerPanelTab } from '../useViewerPanelState'

export function ViewerPanelToggle({
  open,
  onToggle,
  panelId,
  triggerRef,
  disabled = false,
  tooltipContainer,
}: {
  open: boolean
  onToggle: () => void
  panelId: string
  triggerRef?: RefObject<HTMLButtonElement | null>
  disabled?: boolean
  tooltipContainer?: HTMLElement | (() => HTMLElement | null) | null
}) {
  const label = open ? 'Close viewer panel' : 'Open viewer panel'
  return (
    <Tooltip
      title={label}
      slotProps={{
        popper: tooltipContainer ? { container: tooltipContainer } : { disablePortal: true },
      }}
    >
      <IconButton
        ref={triggerRef}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        disabled={disabled}
        data-hriv-canvas-ui
        sx={{
          width: 48,
          height: 48,
          borderRadius: 0,
          color: open ? 'text.secondary' : 'common.white',
          bgcolor: open ? 'transparent' : (theme) => alpha(theme.palette.common.black, 1 / 3),
          '&:hover, &:focus-visible': {
            bgcolor: open ? 'action.hover' : (theme) => alpha(theme.palette.common.black, 7 / 15),
          },
          '&:active': {
            bgcolor: open ? 'action.selected' : (theme) => alpha(theme.palette.common.black, 0.6),
          },
        }}
      >
        <SvgIcon>
          <rect
            x="3"
            y="4"
            width="18"
            height="16"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path d="M16 4v16" fill="none" stroke="currentColor" strokeWidth="2" />
          {open && <path d="M17 5h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2z" />}
        </SvgIcon>
      </IconButton>
    </Tooltip>
  )
}

export interface ViewerSidePanelProps {
  open: boolean
  tab: ViewerPanelTab
  onTabChange: (tab: ViewerPanelTab) => void
  onClose: () => void
  panelId: string
  markers: ReactNode
  details?: ReactNode
  onShareView?: () => void
}

export default function ViewerSidePanel({
  open,
  tab,
  onTabChange,
  onClose,
  panelId,
  markers,
  details,
  onShareView,
}: ViewerSidePanelProps) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (open) {
      const panel = ref.current
      const selectedRow = panel?.querySelector<HTMLButtonElement>(
        '[data-marker-row][aria-pressed="true"]',
      )
      const selectedTab = panel?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ;(selectedRow ?? selectedTab)?.focus()
    }
  }, [open])
  return (
    <Paper
      ref={ref}
      component="aside"
      id={panelId}
      aria-label="Viewer panel"
      aria-hidden={!open}
      data-hriv-canvas-ui
      square
      elevation={0}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: { xs: open ? '100%' : 0, sm: open ? 256 : 0 },
        visibility: open ? 'visible' : 'hidden',
        overflow: 'hidden',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: open ? 1 : 0,
        borderColor: 'divider',
        transition: (theme) =>
          theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: open
              ? theme.transitions.duration.enteringScreen
              : theme.transitions.duration.leavingScreen,
          }),
      }}
    >
      {open && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
              py: 0.5,
            }}
          >
            <ToggleButtonGroup
              exclusive
              value={tab}
              aria-label="Viewer panel content"
              onChange={(_, value: ViewerPanelTab | null) => {
                if (value) onTabChange(value)
              }}
              sx={{
                ml: 1,
                gap: 0.5,
                '& .MuiToggleButtonGroup-grouped': {
                  border: 0,
                  borderRadius: 1,
                  color: 'text.secondary',
                  '&.Mui-selected': { bgcolor: 'action.selected', color: 'text.primary' },
                  '&:hover': { bgcolor: 'action.hover' },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: '-2px',
                  },
                },
              }}
            >
              <ToggleButton disableRipple value="markers" aria-label="Show Markers">
                <Tooltip
                  title="Markers"
                  slotProps={{ popper: { container: () => ref.current?.parentElement ?? null } }}
                >
                  <Room />
                </Tooltip>
              </ToggleButton>
              <ToggleButton disableRipple value="share" aria-label="Show Shared View">
                <Tooltip
                  title="Shared View"
                  slotProps={{ popper: { container: () => ref.current?.parentElement ?? null } }}
                >
                  <Link />
                </Tooltip>
              </ToggleButton>
              <ToggleButton disableRipple value="details" aria-label="Show image details">
                <Tooltip
                  title="Image details"
                  slotProps={{ popper: { container: () => ref.current?.parentElement ?? null } }}
                >
                  <InfoOutlined />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
            <ViewerPanelToggle
              open
              onToggle={onClose}
              panelId={panelId}
              tooltipContainer={() => ref.current?.parentElement ?? null}
            />
          </Box>
          {tab !== 'markers' && (
            <Typography
              component="h2"
              variant="body2"
              sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
            >
              {tab === 'share' ? 'Shared View' : 'Image details'}
            </Typography>
          )}
          <Box
            tabIndex={0}
            role="region"
            aria-label={
              tab === 'markers'
                ? 'Markers list'
                : tab === 'share'
                  ? 'Shared View'
                  : 'Image metadata'
            }
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              ...(tab !== 'markers' ? { px: 1.5, py: 1 } : {}),
            }}
          >
            {tab === 'markers' ? (
              markers
            ) : tab === 'share' ? (
              <Button startIcon={<Link />} onClick={onShareView} disabled={!onShareView}>
                Copy current view
              </Button>
            ) : (
              (details ?? (
                <Typography variant="caption" component="p" color="text.secondary">
                  No details available.
                </Typography>
              ))
            )}
          </Box>
          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderTop: 1,
              borderColor: 'divider',
              flexShrink: 0,
              maxHeight: '35%',
              overflowY: 'auto',
            }}
            tabIndex={0}
            role="region"
            aria-label={tab === 'markers' ? 'About Markers' : 'Viewer controls'}
          >
            <Typography component="h3" variant="caption" sx={{ mb: 0.5, fontWeight: 'medium' }}>
              {tab === 'markers' ? 'About Markers:' : 'Viewer controls'}
            </Typography>
            {tab === 'markers' ? (
              <Typography variant="caption" component="p" color="text.secondary">
                Markers save a location and zoom level so you can return to important areas of an
                image.
              </Typography>
            ) : (
              <ViewerControlHints dense />
            )}
          </Box>
        </>
      )}
    </Paper>
  )
}
