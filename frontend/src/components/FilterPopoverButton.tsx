import { useState } from 'react'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import { alpha, useTheme } from '@mui/material/styles'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'

interface FilterPopoverButtonProps {
  label: string
  activeCount?: number
  children: ReactNode
  panelWidth?: number | string
  sx?: SxProps<Theme>
}

export default function FilterPopoverButton({
  label,
  activeCount = 0,
  children,
  panelWidth = 240,
  sx,
}: FilterPopoverButtonProps) {
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const active = activeCount > 0
  const open = Boolean(anchorEl)

  return (
    <>
      <ButtonBase
        aria-label={label}
        aria-haspopup="dialog"
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
            bgcolor: active ? alpha(theme.palette.secondary.main, 0.1) : 'background.paper',
            color: active ? 'secondary.main' : 'text.primary',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            '&:hover': {
              bgcolor: active
                ? alpha(theme.palette.secondary.main, 0.16)
                : alpha(theme.palette.text.primary, 0.04),
            },
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        <Typography variant="caption" sx={{ fontWeight: 600, lineHeight: 1 }}>
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
              bgcolor: 'secondary.main',
              color: 'secondary.contrastText',
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
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              borderRadius: 2,
              minWidth: panelWidth,
              p: 1.25,
            },
          },
        }}
      >
        {children}
      </Popover>
    </>
  )
}
