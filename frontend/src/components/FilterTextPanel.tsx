import TextField from '@mui/material/TextField'

interface FilterTextPanelProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  width?: number | string
}

export default function FilterTextPanel({
  value,
  onChange,
  placeholder,
  ariaLabel,
  width = 260,
}: FilterTextPanelProps) {
  return (
    <TextField
      autoFocus
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputProps={{ 'aria-label': ariaLabel }}
      sx={{ width }}
    />
  )
}
