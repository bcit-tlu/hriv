import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'

interface FilterBarProps {
  title?: string
  actions?: ReactNode
  clearAction?: ReactNode
  summary?: ReactNode
  summaryLabel?: string
  children: ReactNode
}

export default function FilterBar({
  title = 'Filter by',
  actions,
  clearAction,
  summary,
  summaryLabel = 'Filtered by:',
  children,
}: FilterBarProps) {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{
        mb: 1.25,
        bgcolor: 'transparent',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          overflowY: 'hidden',
          minHeight: 28,
        }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            whiteSpace: 'nowrap',
            fontWeight: 500,
            lineHeight: 1,
            flex: '0 0 auto',
            fontSize: '0.75rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
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
        {clearAction ? (
          <Box sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center' }}>
            {clearAction}
          </Box>
        ) : null}
        {clearAction && actions ? <Divider orientation="vertical" flexItem /> : null}
        {actions ? (
          <Box sx={{ display: 'flex', flexWrap: 'nowrap', gap: 0.5, alignItems: 'center' }}>
            {actions}
          </Box>
        ) : null}
      </Box>
      {summary ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center', pt: 0.75 }}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              fontSize: '0.75rem',
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {summaryLabel}
          </Typography>
          {summary}
        </Box>
      ) : null}
    </Box>
  )
}
