import { useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'

interface MobileInfoStripProps {
  /** Short uppercase section label, e.g. "Note". */
  label: string
  /** Leading accent icon. */
  icon: ReactNode
  /** One-line plain-text preview shown while collapsed. */
  preview?: string
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * Collapsible information strip used in the mobile image viewer (Instruction,
 * Note, Image Details). Accent left-border, uppercase label, a one-line
 * preview while collapsed, and a chevron toggle — matching the mobile design.
 * Theme-aware via MUI palette tokens (works in light / dark / auto).
 */
export default function MobileInfoStrip({
  label,
  icon,
  preview,
  defaultOpen = false,
  children,
}: MobileInfoStripProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        borderLeft: 3,
        borderLeftColor: 'primary.main',
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          py: 1,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          fontFamily: 'inherit',
        }}
      >
        <Box sx={{ display: 'flex', color: 'primary.main', flexShrink: 0 }}>{icon}</Box>
        <Typography
          component="span"
          sx={{
            fontSize: 11,
            fontWeight: 600,
            color: 'primary.main',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          {label}
        </Typography>
        {!open && preview && (
          <Typography
            component="span"
            sx={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: 'text.secondary',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {preview}
          </Typography>
        )}
        <Box sx={{ ml: 'auto', display: 'flex', color: 'text.secondary', flexShrink: 0 }}>
          {open ? (
            <ExpandLessIcon sx={{ fontSize: 18 }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 18 }} />
          )}
        </Box>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.5, pb: 1.5 }}>{children}</Box>
      </Collapse>
    </Box>
  )
}
