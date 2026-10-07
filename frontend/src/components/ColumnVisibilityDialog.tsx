import { useMemo } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { move } from '@dnd-kit/helpers'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import type { DragEndEvent } from '@dnd-kit/react'

export interface ColumnVisibilityOption<Key extends string> {
  key: Key
  label: string
}

interface ColumnVisibilityDialogProps<Key extends string> {
  open: boolean
  title: string
  /** Columns in display order — pass the preference hook's `columnOrder`. */
  columns: readonly ColumnVisibilityOption<Key>[]
  visibleColumns: Record<Key, boolean>
  minimumVisibleColumns?: number
  onClose: () => void
  onToggleColumn: (column: Key) => void
  /**
   * Called with the full column order after a drag/keyboard reorder
   * (issue #1577). When omitted the drag handles are not rendered.
   */
  onReorderColumns?: (orderedKeys: Key[]) => void
}

interface SortableColumnRowProps<Key extends string> {
  column: ColumnVisibilityOption<Key>
  index: number
  checked: boolean
  disabled: boolean
  onToggle: () => void
}

function SortableColumnRow<Key extends string>({
  column,
  index,
  checked,
  disabled,
  onToggle,
}: SortableColumnRowProps<Key>) {
  const { ref, handleRef, isDragSource } = useSortable({
    id: column.key,
    index,
    type: 'table-column',
  })

  return (
    <Box
      ref={ref}
      sx={{
        display: 'flex',
        alignItems: 'center',
        opacity: isDragSource ? 0.4 : 1,
      }}
    >
      <IconButton
        ref={handleRef}
        size="small"
        aria-label={`Reorder ${column.label} column`}
        sx={{ cursor: isDragSource ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <FormControlLabel
        control={<Checkbox checked={checked} disabled={disabled} onChange={onToggle} />}
        label={column.label}
        sx={{ flex: 1, mr: 0 }}
      />
    </Box>
  )
}

export default function ColumnVisibilityDialog<Key extends string>({
  open,
  title,
  columns,
  visibleColumns,
  minimumVisibleColumns = 1,
  onClose,
  onToggleColumn,
  onReorderColumns,
}: ColumnVisibilityDialogProps<Key>) {
  const visibleColumnCount = columns.filter((column) => visibleColumns[column.key]).length

  // Same activation policy as SortableTileGrid: 8px distance for pointer
  // drags, 250ms hold for touch so the dialog can still scroll on mobile.
  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: (event: PointerEvent) => {
          if (event.pointerType === 'touch') {
            return [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
          }
          return [new PointerActivationConstraints.Distance({ value: 8 })]
        },
      }),
      KeyboardSensor,
    ],
    [],
  )

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.canceled || !onReorderColumns) return
    const ids = columns.map((column) => column.key)
    const reordered = move(ids, event)
    if (reordered.length !== ids.length) return
    if (reordered.every((id, i) => id === ids[i])) return
    onReorderColumns(reordered as Key[])
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {onReorderColumns && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Drag to reorder columns, or use the arrow keys on a drag handle.
          </Typography>
        )}
        <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
          <FormGroup>
            {columns.map((column, index) => {
              const checked = visibleColumns[column.key]
              const disableToggleOff = checked && visibleColumnCount <= minimumVisibleColumns

              if (!onReorderColumns) {
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
              }

              return (
                <SortableColumnRow
                  key={column.key}
                  column={column}
                  index={index}
                  checked={checked}
                  disabled={disableToggleOff}
                  onToggle={() => onToggleColumn(column.key)}
                />
              )
            })}
          </FormGroup>
        </DragDropProvider>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}
