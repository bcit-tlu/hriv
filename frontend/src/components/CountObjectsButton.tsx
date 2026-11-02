/**
 * Per-selection "Count objects" pop-up button (epic #1661, #1667).
 *
 * Anchored above a selection rectangle's top-right corner by the parent
 * layer. States:
 *  - idle    — "Count objects" opens a Cells/Nuclei menu
 *  - active  — split button: "Counting…" / "Queued · n ahead" + Cancel
 *  - done    — split button: "View results (N)" + count-again actions
 *  - failed  — back to idle (the error surfaces in the snackbar)
 */

import { useRef, useState } from 'react'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import CircularProgress from '@mui/material/CircularProgress'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'

import type { CountMode } from '../api'
import type { SelectionCountEntry } from '../useSelectionCounts'

export interface CountObjectsButtonProps {
  /** 1-based selection index, for the aria-label ("selection 2"). */
  selectionIndex: number
  entry?: SelectionCountEntry
  onCount: (mode: CountMode) => void
  onCancel: () => void
  onViewResults: () => void
}

const MODE_ITEMS: { mode: CountMode; primary: string; secondary: string }[] = [
  { mode: 'cells', primary: 'Cells', secondary: 'Whole cells, e.g. blood cells' },
  {
    mode: 'nuclei',
    primary: 'Nuclei',
    secondary: 'Cell nuclei, e.g. tissue sections',
  },
]

/** Figma arrow notch: primary-colour square rotated 45° under the button. */
const NOTCH_SX = {
  '&::after': {
    content: '""',
    position: 'absolute',
    right: 18,
    bottom: -6,
    width: 12,
    height: 12,
    bgcolor: 'primary.main',
    transform: 'rotate(45deg)',
    zIndex: -1,
  },
} as const

export default function CountObjectsButton({
  selectionIndex,
  entry,
  onCount,
  onCancel,
  onViewResults,
}: CountObjectsButtonProps) {
  const [modeAnchor, setModeAnchor] = useState<HTMLElement | null>(null)
  const [splitAnchor, setSplitAnchor] = useState<HTMLElement | null>(null)
  const groupRef = useRef<HTMLDivElement>(null)

  const phase = entry?.phase
  const active = phase === 'starting' || phase === 'queued' || phase === 'running'
  const done = phase === 'done'
  const ariaLabel = `Count objects in selection ${selectionIndex}`

  const modeMenu = (
    <Menu
      anchorEl={modeAnchor}
      open={modeAnchor != null}
      onClose={() => setModeAnchor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      {MODE_ITEMS.map(({ mode, primary, secondary }) => (
        <MenuItem
          key={mode}
          onClick={() => {
            setModeAnchor(null)
            onCount(mode)
          }}
        >
          <ListItemText
            primary={primary}
            secondary={secondary}
            // Muted caption text fails axe contrast on the menu surface —
            // keep it readable instead.
            secondaryTypographyProps={{ variant: 'caption', color: 'text.primary' }}
          />
        </MenuItem>
      ))}
    </Menu>
  )

  if (active || done) {
    const mainLabel = active
      ? entry?.queuePosition != null && entry.queuePosition > 0
        ? `Queued · ${entry.queuePosition} ahead`
        : 'Counting…'
      : `View results (${entry?.result?.total ?? 0})`
    return (
      <Box data-hriv-canvas-ui sx={{ position: 'relative' }}>
        <ButtonGroup
          ref={groupRef}
          variant="contained"
          size="small"
          sx={{ boxShadow: 4, whiteSpace: 'nowrap' }}
          aria-label={ariaLabel}
        >
          <Button
            onClick={done ? onViewResults : undefined}
            disabled={active}
            // Default disabled colours (grey on grey) fail axe contrast —
            // keep the active job's main segment readable instead.
            sx={
              active
                ? {
                    '&.Mui-disabled': {
                      color: 'primary.contrastText',
                      bgcolor: 'primary.main',
                      opacity: 0.9,
                    },
                  }
                : undefined
            }
            startIcon={
              active ? (
                <CircularProgress size={14} color="inherit" aria-label="Count in progress" />
              ) : (
                <AutoAwesomeOutlinedIcon />
              )
            }
          >
            {mainLabel}
          </Button>
          <Button
            size="small"
            aria-label={`${ariaLabel} — more actions`}
            aria-haspopup="menu"
            aria-expanded={splitAnchor != null}
            onClick={(e) => setSplitAnchor(e.currentTarget)}
          >
            <ArrowDropDownIcon />
          </Button>
        </ButtonGroup>
        <Menu
          anchorEl={splitAnchor}
          open={splitAnchor != null}
          onClose={() => setSplitAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {active ? (
            <MenuItem
              onClick={() => {
                setSplitAnchor(null)
                onCancel()
              }}
            >
              Cancel count
            </MenuItem>
          ) : (
            MODE_ITEMS.map(({ mode, primary }) => (
              <MenuItem
                key={mode}
                onClick={() => {
                  setSplitAnchor(null)
                  onCount(mode)
                }}
              >
                Count {primary.toLowerCase()} again
              </MenuItem>
            ))
          )}
        </Menu>
      </Box>
    )
  }

  return (
    <Box data-hriv-canvas-ui sx={{ position: 'relative' }}>
      <Button
        variant="contained"
        size="small"
        startIcon={<AutoAwesomeOutlinedIcon />}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={modeAnchor != null}
        onClick={(e) => setModeAnchor(e.currentTarget)}
        sx={{ whiteSpace: 'nowrap', boxShadow: 4, ...NOTCH_SX }}
      >
        Count objects
      </Button>
      {modeMenu}
    </Box>
  )
}
