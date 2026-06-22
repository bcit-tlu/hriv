import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import type { MoveRestrictionChange } from '../categoryUtils'
import type { Group, Program } from '../types'

interface MoveRestrictionConfirmDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  categoryLabel: string
  destinationLabel: string
  change: MoveRestrictionChange
  programs?: Program[]
  groups?: Group[]
}

function programName(id: number, programs: Program[]): string {
  return programs.find((p) => p.id === id)?.name ?? String(id)
}

function groupName(id: number, groups: Group[]): string {
  return groups.find((g) => g.id === id)?.name ?? String(id)
}

function RestrictionRow({
  label,
  ids,
  names,
  empty,
}: {
  label: string
  ids: number[]
  names: string[]
  empty: string
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <Typography variant="body2" sx={{ minWidth: 80, pt: 0.25, color: 'text.secondary' }}>
        {label}
      </Typography>
      {ids.length === 0 ? (
        <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.disabled' }}>
          {empty}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {names.map((name, i) => (
            <Chip key={ids[i]} label={name} size="small" />
          ))}
        </Box>
      )}
    </Box>
  )
}

export default function MoveRestrictionConfirmDialog({
  open,
  onConfirm,
  onCancel,
  categoryLabel,
  destinationLabel,
  change,
  programs = [],
  groups = [],
}: MoveRestrictionConfirmDialogProps) {
  const oldPrograms = change.oldEffectiveProgramIds
  const newPrograms = change.newEffectiveProgramIds
  const oldGroups = change.oldEffectiveGroupIds
  const newGroups = change.newEffectiveGroupIds

  const hasProgramChange =
    oldPrograms.length !== newPrograms.length ||
    !oldPrograms.every((id) => newPrograms.includes(id))
  const hasGroupChange =
    oldGroups.length !== newGroups.length || !oldGroups.every((id) => newGroups.includes(id))

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Confirm Move</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2">
          Moving <strong>&ldquo;{categoryLabel}&rdquo;</strong> to{' '}
          <strong>&ldquo;{destinationLabel}&rdquo;</strong> will change its effective access
          restrictions.
        </Typography>

        {hasProgramChange && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="subtitle2">Program restriction</Typography>
            <RestrictionRow
              label="Before:"
              ids={oldPrograms}
              names={oldPrograms.map((id) => programName(id, programs))}
              empty="Unrestricted (all programs)"
            />
            <RestrictionRow
              label="After:"
              ids={newPrograms}
              names={newPrograms.map((id) => programName(id, programs))}
              empty="Unrestricted (all programs)"
            />
          </Box>
        )}

        {hasGroupChange && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="subtitle2">Group restriction</Typography>
            <RestrictionRow
              label="Before:"
              ids={oldGroups}
              names={oldGroups.map((id) => groupName(id, groups))}
              empty="Unrestricted (all groups)"
            />
            <RestrictionRow
              label="After:"
              ids={newGroups}
              names={newGroups.map((id) => groupName(id, groups))}
              empty="Unrestricted (all groups)"
            />
          </Box>
        )}

        <Alert severity="info">
          The category&rsquo;s own direct restrictions are preserved; the effective access shown
          above reflects how its restrictions combine with the new ancestor&rsquo;s restrictions.
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm} variant="contained">
          Move Anyway
        </Button>
      </DialogActions>
    </Dialog>
  )
}
