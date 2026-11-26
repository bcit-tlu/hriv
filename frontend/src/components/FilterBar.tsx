import type { ReactNode } from 'react'
import FilterListIcon from '@mui/icons-material/FilterList'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'

interface FilterBarProps {
  title?: string
  ariaLabel?: string
  actions?: ReactNode
  clearAction?: ReactNode
  summary?: ReactNode
  summaryActions?: ReactNode
  /** Wrap the filter controls onto more lines instead of letting them spill
   *  over the clear/actions buttons when the row is too narrow. */
  wrap?: boolean
  sx?: SxProps<Theme>
  children: ReactNode
}

export default function FilterBar({
  title = 'FILTER BY:',
  ariaLabel = 'Filter by',
  actions,
  clearAction,
  summary,
  summaryActions,
  wrap = false,
  sx,
  children,
}: FilterBarProps) {
  const titleContent = (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <FilterListIcon sx={{ fontSize: 14 }} />
      <Box component="span" sx={{ pl: 0.25 }}>
        {title}
      </Box>
    </Box>
  )

  return (
    <Box
      component="section"
      aria-label={ariaLabel}
      sx={{
        mb: 1.25,
        bgcolor: 'transparent',
        ...sx,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          // Baseline keeps the label on the first line once the controls wrap.
          alignItems: wrap ? 'baseline' : 'center',
          gap: 1.25,
          // When even 240px won't fit beside the label and actions (phones), the
          // controls move to their own full-width line instead of collapsing to 0.
          flexWrap: wrap ? 'wrap' : 'nowrap',
          overflowX: 'auto',
          overflowY: 'hidden',
          // Reserve room for a size="small" action button even when a
          // consumer passes no actions — keeps the FILTER BY row the same
          // height (and the label at the same offset) on every page.
          minHeight: 30.75,
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
          {titleContent}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            minWidth: 0,
            flexWrap: wrap ? 'wrap' : 'nowrap',
            gap: 1,
            alignItems: 'center',
            // Wrap mode: take (nearly) all free space so chips wrap as late as possible.
            flex: wrap ? '999 1 240px' : '0 1 auto',
          }}
        >
          {children}
        </Box>
        {clearAction ? (
          <Box sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center' }}>
            {clearAction}
          </Box>
        ) : null}
        {actions ? <Box sx={{ flex: 1, minWidth: 0 }} /> : null}
        {actions ? (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'nowrap',
              gap: 0.5,
              alignItems: 'center',
              color: 'text.secondary',
            }}
          >
            {actions}
          </Box>
        ) : null}
      </Box>
      {summary ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', pt: 0.75, minWidth: 0 }}>
          <Box aria-hidden="true" sx={{ visibility: 'hidden', flex: '0 0 auto' }}>
            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'nowrap',
                fontWeight: 500,
                lineHeight: 1,
                fontSize: '0.75rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {titleContent}
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.75,
              alignItems: 'center',
              minWidth: 0,
              flex: 1,
            }}
          >
            {summary}
          </Box>
          {summaryActions ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                whiteSpace: 'nowrap',
                pr: 0.5,
              }}
            >
              {summaryActions}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}
