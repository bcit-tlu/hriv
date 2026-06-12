import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'

export interface ColumnVisibilityOption<Key extends string> {
  key: Key
  label: string
}

interface ColumnVisibilityDialogProps<Key extends string> {
  open: boolean
  title: string
  columns: readonly ColumnVisibilityOption<Key>[]
  visibleColumns: Record<Key, boolean>
  minimumVisibleColumns?: number
  onClose: () => void
  onToggleColumn: (column: Key) => void
}

export default function ColumnVisibilityDialog<Key extends string>({
  open,
  title,
  columns,
  visibleColumns,
  minimumVisibleColumns = 1,
  onClose,
  onToggleColumn,
}: ColumnVisibilityDialogProps<Key>) {
  const visibleColumnCount = columns.filter((column) => visibleColumns[column.key]).length

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <FormGroup>
          {columns.map((column) => {
            const checked = visibleColumns[column.key]
            const disableToggleOff = checked && visibleColumnCount <= minimumVisibleColumns

            return (
              <FormControlLabel
                key={column.key}
                control={
                  <Checkbox
                    checked={checked}
                    disabled={disableToggleOff}
                    onChange={() => onToggleColumn(column.key)}
                  />
                }
                label={column.label}
              />
            )
          })}
        </FormGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}
