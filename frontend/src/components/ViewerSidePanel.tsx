import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Box,
  IconButton,
  Paper,
  SvgIcon,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { CompassCalibration, InfoOutlined } from '@mui/icons-material'
import { ViewerControlHints } from './ImageDetailsDrawer'
import type { ViewerPanelTab } from '../useViewerPanelState'

export function ViewerPanelToggle({
  open,
  onToggle,
  panelId,
  triggerRef,
  disabled = false,
}: {
  open: boolean
  onToggle: () => void
  panelId: string
  triggerRef?: RefObject<HTMLButtonElement | null>
  disabled?: boolean
}) {
  const label = open ? 'Close viewer panel' : 'Open viewer panel'
  return (
    <Tooltip title={label} slotProps={{ popper: { disablePortal: true } }}>
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
  count: number
  inuksuks: ReactNode
  details?: ReactNode
}

export default function ViewerSidePanel({
  open,
  tab,
  onTabChange,
  onClose,
  panelId,
  count,
  inuksuks,
  details,
}: ViewerSidePanelProps) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
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
        width: { xs: open ? '100%' : 0, sm: open ? 320 : 0 },
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
              <ToggleButton disableRipple value="inuksuks" aria-label="Show Inuksuks">
                <Tooltip title="Inuksuks">
                  <CompassCalibration />
                </Tooltip>
              </ToggleButton>
              <ToggleButton disableRipple value="details" aria-label="Show image details">
                <Tooltip title="Image details">
                  <InfoOutlined />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
            <ViewerPanelToggle open onToggle={onClose} panelId={panelId} />
          </Box>
          <Typography
            component="h2"
            variant="subtitle1"
            sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
          >
            {tab === 'inuksuks' ? `Inuksuks (${count})` : 'Image details'}
          </Typography>
          <Box
            tabIndex={0}
            role="region"
            aria-label={tab === 'inuksuks' ? 'Inuksuks list' : 'Image metadata'}
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              ...(tab === 'details' ? { px: 2, py: 1.5 } : {}),
            }}
          >
            {tab === 'inuksuks'
              ? inuksuks
              : (details ?? (
                  <Typography variant="body2" color="text.secondary">
                    No details available.
                  </Typography>
                ))}
          </Box>
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderTop: 1,
              borderColor: 'divider',
              flexShrink: 0,
              maxHeight: '35%',
              overflowY: 'auto',
            }}
            tabIndex={0}
            role="region"
            aria-label={tab === 'inuksuks' ? 'About Inuksuks' : 'Viewer controls'}
          >
            <Typography component="h3" variant="subtitle2" sx={{ mb: 0.5 }}>
              {tab === 'inuksuks' ? 'About Inuksuks:' : 'Viewer controls'}
            </Typography>
            {tab === 'inuksuks' ? (
              <Typography variant="body2" color="text.secondary">
                Inuksuks save a location and zoom level so you can return to important areas of an
                image.
              </Typography>
            ) : (
              <ViewerControlHints />
            )}
          </Box>
        </>
      )}
    </Paper>
  )
}
