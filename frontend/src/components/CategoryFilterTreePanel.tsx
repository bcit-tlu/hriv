import { useMemo } from 'react'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { Category } from '../types'
import { flattenCategoryOptions } from './categoryOptionUtils'
import { useCategoryTreeExpansionPreferences } from '../useCategoryTreeExpansionPreferences'

interface CategoryFilterTreePanelProps {
  categories: Category[]
  selectedIds: ReadonlySet<number>
  onToggle: (id: number) => void
}

export default function CategoryFilterTreePanel({
  categories,
  selectedIds,
  onToggle,
}: CategoryFilterTreePanelProps) {
  const options = useMemo(() => flattenCategoryOptions(categories), [categories])
  const { visibleOptions, isExpanded, toggleExpanded } =
    useCategoryTreeExpansionPreferences(options)

  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      {visibleOptions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No categories
        </Typography>
      ) : (
        visibleOptions.map((option) => {
          const selected = selectedIds.has(option.id)
          const hasChildren = option.childCount > 0
          const expanded = isExpanded(option.id)

          return (
            <Box
              key={option.id}
              role="menuitemcheckbox"
              aria-checked={selected}
              tabIndex={0}
              onClick={() => onToggle(option.id)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault()
                  onToggle(option.id)
                  return
                }

                const items = Array.from(
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                    '[role="menuitemcheckbox"]',
                  ) ?? [],
                )
                const index = items.indexOf(event.currentTarget)
                if (index === -1) return

                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  items[(index + 1) % items.length]?.focus()
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  items[(index - 1 + items.length) % items.length]?.focus()
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  items[0]?.focus()
                } else if (event.key === 'End') {
                  event.preventDefault()
                  items[items.length - 1]?.focus()
                }
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                pl: 1 + option.depth * 3,
                pr: 1,
                py: 0.5,
                borderRadius: 1,
                cursor: 'pointer',
                userSelect: 'none',
                bgcolor: selected
                  ? (theme) =>
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.primary.main, 0.16)
                        : alpha(theme.palette.primary.main, 0.08)
                  : 'transparent',
                '&:hover': {
                  bgcolor: (theme) =>
                    selected
                      ? theme.palette.mode === 'dark'
                        ? alpha(theme.palette.primary.main, 0.22)
                        : alpha(theme.palette.primary.main, 0.12)
                      : alpha(theme.palette.text.primary, 0.04),
                },
              }}
            >
              {hasChildren ? (
                <Tooltip title={expanded ? 'Collapse category' : 'Expand category'}>
                  <IconButton
                    edge="start"
                    size="small"
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${option.label}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleExpanded(option.id)
                    }}
                    sx={{ p: 0, width: 30, flexShrink: 0 }}
                  >
                    {expanded ? (
                      <ExpandMoreIcon fontSize="small" />
                    ) : (
                      <ChevronRightIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              ) : (
                <Box sx={{ width: 30, flexShrink: 0 }} />
              )}
              <Checkbox
                size="small"
                checked={selected}
                tabIndex={-1}
                aria-label={option.label}
                onClick={(event) => event.stopPropagation()}
                onChange={() => onToggle(option.id)}
                sx={{ p: 0 }}
                color="primary"
              />
              <Typography variant="body2" component="span">
                {option.label}
              </Typography>
            </Box>
          )
        })
      )}
    </Stack>
  )
}
