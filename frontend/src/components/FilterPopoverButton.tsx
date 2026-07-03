import { useState } from 'react'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'

interface FilterPopoverButtonProps {
  label: string
  activeCount?: number
  children: ReactNode
  panelWidth?: number | string
  sx?: SxProps<Theme>
}

export function filterSurfaceBg(theme: Theme): string {
  return theme.palette.mode === 'dark'
    ? alpha(theme.palette.common.white, 0.06)
    : alpha(theme.palette.text.secondary, 0.08)
}

export default function FilterPopoverButton({
  label,
  activeCount = 0,
  children,
  panelWidth = 240,
  sx,
}: FilterPopoverButtonProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const active = activeCount > 0
  const open = Boolean(anchorEl)

  return (
    <>
      <ButtonBase
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : undefined}
        onClick={(event) =>
          setAnchorEl((current) => (current === event.currentTarget ? null : event.currentTarget))
        }
        sx={[
          {
            height: 28,
            px: 1.25,
            borderRadius: 1.5,
            border: '1px solid',
            borderColor: active ? 'secondary.main' : 'divider',
            bgcolor: (theme) =>
              active ? alpha(theme.palette.secondary.main, 0.1) : filterSurfaceBg(theme),
            color: active ? 'secondary.main' : 'text.primary',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            '&:hover': {
              bgcolor: (theme) =>
                active
                  ? alpha(theme.palette.secondary.main, 0.16)
                  : alpha(theme.palette.text.primary, 0.06),
            },
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        <Typography variant="caption" sx={{ fontWeight: 400, lineHeight: 1 }}>
          {label}
        </Typography>
        {active ? (
          <Box
            component="span"
            sx={{
              minWidth: 16,
              height: 16,
              px: 0.5,
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontSize: '0.65rem',
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {activeCount}
          </Box>
        ) : null}
        <ArrowDropDownIcon sx={{ fontSize: 16, color: 'inherit' }} />
      </ButtonBase>
      <Popper
        open={open}
        anchorEl={anchorEl}
        placement="bottom-start"
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
      >
        <Paper sx={{ mt: 0.75, borderRadius: 2, minWidth: panelWidth, p: 1.25, boxShadow: 4 }}>
          <ClickAwayListener onClickAway={() => setAnchorEl(null)}>
            <Box>{children}</Box>
          </ClickAwayListener>
        </Paper>
      </Popper>
    </>
  )
}
