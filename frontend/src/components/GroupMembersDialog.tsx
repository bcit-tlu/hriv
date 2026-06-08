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
import {
  addGroupInstructor,
  addGroupMember,
  fetchUsers,
  removeGroupInstructor,
  removeGroupMember,
} from '../api'
import type { ApiUser } from '../api'
import { apiGroupToGroup } from '../groupUtils'
import type { Group } from '../types'

interface GroupMembersDialogProps {
  open: boolean
  onClose: () => void
  group: Group | null
  /** Propagates the updated group (from the API response) back to the parent. */
  onGroupUpdated: (group: Group) => void
}

/**
 * Lets an instructor (or admin) manage a group's student members and
 * instructor co-owners. Membership mutations return the full updated group,
 * so we trust the server's member_ids/instructor_ids rather than re-deriving
 * them locally. The backend enforces role constraints (members must be
 * students, instructors must be instructors) and the last-instructor guard.
 */
export default function GroupMembersDialog({
  open,
  onClose,
  group,
  onGroupUpdated,
}: GroupMembersDialogProps) {
  const [students, setStudents] = useState<ApiUser[]>([])
  const [instructors, setInstructors] = useState<ApiUser[]>([])
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set())
  const [instructorIds, setInstructorIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!group) return
    setLoading(true)
    setError(null)
    try {
      const [studentList, instructorList] = await Promise.all([
        fetchUsers('student'),
        fetchUsers('instructor'),
      ])
      setStudents(studentList)
      setInstructors(instructorList)
    } catch {
      setError('Failed to load users.')
    } finally {
      setLoading(false)
    }
    // Only the group id matters for which users to fetch; depending on the
    // whole `group` would re-fetch on every membership mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id])

  // Fetch the user lists once per open/group — not on every membership
  // change. A membership toggle flows a new `group` prop in (same id), which
  // must not trigger a re-fetch or the dialog would flash a spinner each time.
  useEffect(() => {
    if (open && group) {
      load()
    } else if (!open) {
      setStudents([])
      setInstructors([])
      setError(null)
    }
    // Intentionally keyed on group id, not the whole group, so a membership
    // mutation (same id) does not re-trigger the user fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.id, load])

  // Keep the local selection in sync with the latest group, including the
  // updated member_ids/instructor_ids returned after a membership mutation.
  useEffect(() => {
    if (group) {
      setMemberIds(new Set(group.memberIds))
      setInstructorIds(new Set(group.instructorIds))
    }
  }, [group])

  const toggleMember = async (student: ApiUser, member: boolean) => {
    if (!group) return
    setPendingId(student.id)
    setError(null)
    try {
      const updated = member
        ? await addGroupMember(group.id, student.id)
        : await removeGroupMember(group.id, student.id)
      const mapped = apiGroupToGroup(updated)
      setMemberIds(new Set(mapped.memberIds))
      setInstructorIds(new Set(mapped.instructorIds))
      onGroupUpdated(mapped)
    } catch {
      setError(
        member
          ? 'Failed to add student to group.'
          : 'Failed to remove student from group.',
      )
    } finally {
      setPendingId(null)
    }
  }

  const toggleInstructor = async (instructor: ApiUser, isOwner: boolean) => {
    if (!group) return
    setPendingId(instructor.id)
    setError(null)
    try {
      const updated = isOwner
        ? await addGroupInstructor(group.id, instructor.id)
        : await removeGroupInstructor(group.id, instructor.id)
      const mapped = apiGroupToGroup(updated)
      setMemberIds(new Set(mapped.memberIds))
      setInstructorIds(new Set(mapped.instructorIds))
      onGroupUpdated(mapped)
    } catch {
      setError(
        isOwner
          ? 'Failed to add instructor to group.'
          : 'Failed to remove instructor (a group must keep at least one).',
      )
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {group ? `Manage members — ${group.name}` : 'Manage members'}
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
        ) : (
          <>
            <Typography variant="subtitle2" gutterBottom>
              Students
            </Typography>
            {students.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No students available.
              </Typography>
            ) : (
              <List dense>
                {students.map((s) => {
                  const member = memberIds.has(s.id)
                  return (
                    <ListItem
                      key={s.id}
                      secondaryAction={
                        <Switch
                          edge="end"
                          checked={member}
                          disabled={pendingId === s.id}
                          onChange={(e) => toggleMember(s, e.target.checked)}
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

            <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
              Instructors (co-owners)
            </Typography>
            {instructors.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No instructors available.
              </Typography>
            ) : (
              <List dense>
                {instructors.map((i) => {
                  const owner = instructorIds.has(i.id)
                  return (
                    <ListItem
                      key={i.id}
                      secondaryAction={
                        <Switch
                          edge="end"
                          checked={owner}
                          disabled={pendingId === i.id}
                          onChange={(e) => toggleInstructor(i, e.target.checked)}
                          slotProps={{
                            input: {
                              'aria-label': `toggle ${i.name} co-ownership`,
                            },
                          }}
                        />
                      }
                    >
                      <ListItemText primary={i.name} secondary={i.email} />
                    </ListItem>
                  )
                })}
              </List>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
