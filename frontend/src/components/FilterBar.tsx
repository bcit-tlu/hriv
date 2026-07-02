import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'

interface FilterBarProps {
  title?: string
  actions?: ReactNode
  children: ReactNode
}

export default function FilterBar({ title = 'Filter by', actions, children }: FilterBarProps) {
  return (
    <Paper
      component="section"
      aria-label={title}
      variant="outlined"
      sx={{
        p: 1.5,
        mb: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 1,
          mb: 1.25,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="subtitle2">{title}</Typography>
        {actions ? (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            {actions}
          </Box>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}>
        {children}
      </Box>
    </Paper>
  )
}
