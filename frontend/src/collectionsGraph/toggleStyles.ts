import type { SxProps, Theme } from '@mui/material/styles'
import { alpha } from '@mui/material/styles'

// Shared accent for the collections-page toggle family (view switch,
// graph order, Shared only): primary-coloured label/border so the active
// state reads clearly in both light and dark themes.
export const graphToggleSx: SxProps<Theme> = {
  '& .MuiToggleButton-root, &.MuiToggleButton-root': {
    color: 'primary.main',
    borderColor: 'primary.main',
    '&.Mui-selected': {
      color: 'primary.main',
      bgcolor: (t) => alpha(t.palette.primary.main, 0.14),
      '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.2) },
    },
    '&.Mui-disabled': { color: 'text.disabled', borderColor: 'divider' },
  },
}
