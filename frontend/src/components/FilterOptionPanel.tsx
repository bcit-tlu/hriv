import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Radio from '@mui/material/Radio'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { alpha } from '@mui/material/styles'

interface FilterOption {
  value: string
  label: string
}

interface FilterOptionPanelProps {
  options: readonly FilterOption[]
  selectedValues: readonly string[]
  onChange: (values: string[]) => void
  searchPlaceholder?: string
  multiple?: boolean
  emptyLabel?: string
}

export default function FilterOptionPanel({
  options,
  selectedValues,
  onChange,
  searchPlaceholder,
  multiple = true,
  emptyLabel = 'No options',
}: FilterOptionPanelProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const optionRole = multiple ? 'menuitemcheckbox' : 'menuitemradio'

  const filteredOptions = useMemo(
    () =>
      normalizedQuery.length === 0
        ? options
        : options.filter((option) => option.label.toLowerCase().includes(normalizedQuery)),
    [normalizedQuery, options],
  )

  return (
    <Stack spacing={1}>
      {searchPlaceholder ? (
        <TextField
          size="small"
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          inputProps={{ 'aria-label': searchPlaceholder }}
        />
      ) : null}
      <Box sx={{ minWidth: 0 }}>
        {filteredOptions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {emptyLabel}
          </Typography>
        ) : (
          filteredOptions.map((option) => {
            const selected = selectedValues.includes(option.value)
            return (
              <Box
                key={option.value}
                role={optionRole}
                aria-checked={selected}
                onClick={() => {
                  if (multiple) {
                    onChange(
                      selected
                        ? selectedValues.filter((value) => value !== option.value)
                        : [...selectedValues, option.value],
                    )
                  } else {
                    onChange(selected ? [] : [option.value])
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.625,
                  borderRadius: 1,
                  cursor: 'pointer',
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
                {multiple ? (
                  <Checkbox
                    size="small"
                    checked={selected}
                    tabIndex={-1}
                    sx={{ p: 0 }}
                    color="primary"
                  />
                ) : (
                  <Radio
                    size="small"
                    checked={selected}
                    tabIndex={-1}
                    sx={{ p: 0 }}
                    color="primary"
                  />
                )}
                <Typography variant="body2">{option.label}</Typography>
              </Box>
            )
          })
        )}
      </Box>
    </Stack>
  )
}
