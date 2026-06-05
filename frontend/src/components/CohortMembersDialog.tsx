import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { addCohortMember, fetchUsers, removeCohortMember } from '../api'
import type { ApiUser } from '../api'
import type { Program } from '../types'

interface CohortMembersDialogProps {
  open: boolean
  onClose: () => void
  cohort: Program | null
}

/**
 * Lets an instructor (or admin) add/remove students to/from a cohort using the
 * delta membership endpoints. Eligible students are those who already belong to
 * the cohort's parent tenant — the backend enforces the same rule, so an
 * unexpected student simply yields a 403.
 */
export default function CohortMembersDialog({
  open,
  onClose,
  cohort,
}: CohortMembersDialogProps) {
  const [students, setStudents] = useState<ApiUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!cohort) return
    setLoading(true)
    setError(null)
    try {
      const all = await fetchUsers()
      // Only students who belong to this cohort's parent tenant are eligible.
      const eligible = all.filter(
        (u) =>
          u.role === 'student' &&
          cohort.parent_program_id !== null &&
          u.program_ids.includes(cohort.parent_program_id),
      )
      setStudents(eligible)
    } catch {
      setError('Failed to load students.')
    } finally {
      setLoading(false)
    }
  }, [cohort])

  useEffect(() => {
    if (open && cohort) {
      load()
    } else if (!open) {
      setStudents([])
      setError(null)
    }
  }, [open, cohort, load])

  const toggle = async (student: ApiUser, member: boolean) => {
    if (!cohort) return
    setPendingId(student.id)
    setError(null)
    try {
      // The endpoints return the updated user; trust the server's
      // program_ids rather than re-deriving them locally so any cascading
      // server-side membership changes are reflected accurately.
      const updated = member
        ? await addCohortMember(cohort.id, student.id)
        : await removeCohortMember(cohort.id, student.id)
      setStudents((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      )
    } catch {
      setError(
        member
          ? 'Failed to add student to cohort.'
          : 'Failed to remove student from cohort.',
      )
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {cohort ? `Manage students — ${cohort.name}` : 'Manage students'}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={28} />
          </Box>
        ) : students.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No eligible students in this cohort's program.
          </Typography>
        ) : (
          <List dense>
            {students.map((s) => {
              const member = cohort ? s.program_ids.includes(cohort.id) : false
              return (
                <ListItem
                  key={s.id}
                  secondaryAction={
                    <Switch
                      edge="end"
                      checked={member}
                      disabled={pendingId === s.id}
                      onChange={(e) => toggle(s, e.target.checked)}
                      slotProps={{
                        input: {
                          'aria-label': `toggle ${s.name} membership`,
                        },
                      }}
                    />
                  }
                >
                  <ListItemText primary={s.name} secondary={s.email} />
                </ListItem>
              )
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
