import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

interface FilterBarProps {
  title?: string
  actions?: ReactNode
  children: ReactNode
}

export default function FilterBar({ title = 'Filter by', actions, children }: FilterBarProps) {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{
        mb: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: 'transparent',
        flexWrap: 'nowrap',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          whiteSpace: 'nowrap',
          fontWeight: 500,
          lineHeight: 1,
          py: 0.75,
        }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          minWidth: 0,
          flexWrap: 'nowrap',
          gap: 1,
          alignItems: 'center',
        }}
      >
        {children}
      </Box>
      {actions ? (
        <Box sx={{ display: 'flex', flexWrap: 'nowrap', gap: 0.5, alignItems: 'center' }}>
          {actions}
        </Box>
      ) : null}
    </Box>
  )
}
