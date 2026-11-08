import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Switch from '@mui/material/Switch'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { Role, Program } from '../types'
import type { ApiUser } from '../api'
import { userMessage } from '../api'

export interface PersonFormData {
  name: string
  email: string
  role: Role
  active: boolean
  password?: string
  must_change_password?: boolean
  program_ids?: number[]
}

interface AddEditPersonModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: PersonFormData) => Promise<void>
  programs: Program[]
  /** If provided, we are editing; otherwise adding. */
  user?: ApiUser | null
  onClearPassword?: () => Promise<void>
  selfProfile?: boolean
}

function AddEditPersonForm({
  onClose,
  onSave,
  onSavingChange,
  programs,
  user,
  onClearPassword,
  selfProfile = false,
}: Omit<AddEditPersonModalProps, 'open'> & { onSavingChange?: (saving: boolean) => void }) {
  const isEdit = Boolean(user)
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState(false)
  const [mustChange, setMustChange] = useState(user?.must_change_password ?? false)
  const [clearOpen, setClearOpen] = useState(false)
  const [role, setRole] = useState<Role>((user?.role as Role) ?? 'student')
  const [active, setActive] = useState(user?.active ?? true)
  const [programIds, setProgramIds] = useState<number[]>(user?.program_ids ?? [])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const passwordError =
    password &&
    (!isEdit && invite
      ? false
      : Array.from(password).length < 8
        ? 'Password must be at least 8 characters'
        : new TextEncoder().encode(password).length > 72
          ? 'Password must be at most 72 UTF-8 bytes'
          : false)
  const forceDisabledReason = user?.oidc_linked
    ? 'Managed by the identity provider'
    : !user?.has_local_password
      ? 'Set a local password before requiring a password change'
      : ''

  const handleSave = async () => {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName || !trimmedEmail) return
    if (!isEdit && !invite && !password) return
    if (passwordError) return

    const data: PersonFormData = {
      name: trimmedName,
      email: trimmedEmail,
      role,
      active,
      program_ids: programIds,
    }
    if (password && (isEdit ? !user?.oidc_linked : !invite)) {
      data.password = password
    }
    if (isEdit && !selfProfile && !forceDisabledReason) data.must_change_password = mustChange
    setSaving(true)
    onSavingChange?.(true)
    setSaveError(null)
    try {
      await onSave(data)
    } catch (err) {
      setSaveError(userMessage(err, 'Failed to save. Please try again.'))
    } finally {
      setSaving(false)
      onSavingChange?.(false)
    }
  }

  const handleRoleChange = (e: SelectChangeEvent) => {
    setRole(e.target.value as Role)
  }

  const handleProgramChange = (e: SelectChangeEvent<number[]>) => {
    const val = e.target.value
    setProgramIds(typeof val === 'string' ? [] : val)
  }

  const handleClose = () => {
    if (saving) return
    onClose()
  }

  const canSave =
    !saving &&
    !passwordError &&
    (isEdit
      ? name.trim() !== '' && email.trim() !== ''
      : name.trim() !== '' && email.trim() !== '' && (invite || password !== ''))

  // Build the full list of programs to show in the dropdown: active programs
  // plus any programs the user is currently assigned to that may have been
  // deleted (so they can be deselected). Deleted entries are visually
  // distinguished by chip colour but remain selectable so users can remove them.
  const activeProgramIds = new Set(programs.map((p) => p.id))
  const orphanedProgramIds = programIds.filter((id) => !activeProgramIds.has(id))
  const allDropdownPrograms: Array<{ id: number; name: string; deleted: boolean }> = [
    ...programs.map((p) => ({ id: p.id, name: p.name, deleted: false })),
    ...orphanedProgramIds.map((id) => ({ id, name: `Program #${id} (deleted)`, deleted: true })),
  ]

  return (
    <>
      <DialogTitle id="person-form-title">{isEdit ? 'Edit Person' : 'Add Person'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {saveError && (
          <Alert severity="error" onClose={() => setSaveError(null)}>
            {saveError}
          </Alert>
        )}
        <TextField
          autoFocus
          label="Full name"
          fullWidth
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1 }}
        />
        <TextField
          label="Email"
          fullWidth
          variant="outlined"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {!isEdit && (
          <FormControl>
            <Typography id="password-mode-label" variant="body2">
              Password setup
            </Typography>
            <RadioGroup
              aria-labelledby="password-mode-label"
              value={invite ? 'invite' : 'password'}
              onChange={(event) => setInvite(event.target.value === 'invite')}
            >
              <FormControlLabel value="password" control={<Radio />} label="Set password now" />
              <FormControlLabel
                value="invite"
                control={<Radio />}
                label="Invite by link (user sets their own password)"
              />
            </RadioGroup>
          </FormControl>
        )}
        {(isEdit || !invite) && (
          <TextField
            label={isEdit ? 'Password (leave blank to keep)' : 'Password'}
            type="password"
            fullWidth
            variant="outlined"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={Boolean(user?.oidc_linked)}
            error={Boolean(passwordError)}
            helperText={
              user?.oidc_linked ? 'Managed by the identity provider' : passwordError || undefined
            }
            slotProps={{
              formHelperText: { sx: { '&.Mui-disabled': { color: 'text.secondary' } } },
            }}
          />
        )}
        {isEdit && !selfProfile && (
          <>
            <Tooltip title={forceDisabledReason} describeChild>
              <span>
                <FormControlLabel
                  control={
                    <Switch
                      checked={mustChange}
                      disabled={Boolean(forceDisabledReason) || saving}
                      onChange={(event) => setMustChange(event.target.checked)}
                    />
                  }
                  label="Force password change on next login"
                />
              </span>
            </Tooltip>
            {onClearPassword && (
              <Tooltip
                title={
                  user?.oidc_linked
                    ? 'Managed by the identity provider'
                    : !user?.has_local_password
                      ? 'No local password to clear'
                      : ''
                }
                describeChild
              >
                <span>
                  <Button
                    disabled={saving || Boolean(user?.oidc_linked) || !user?.has_local_password}
                    onClick={() => {
                      setSaveError(null)
                      setClearOpen(true)
                    }}
                  >
                    Clear password
                  </Button>
                </span>
              </Tooltip>
            )}
          </>
        )}
        <FormControl fullWidth>
          <InputLabel id="person-role-label">Role</InputLabel>
          <Select labelId="person-role-label" value={role} label="Role" onChange={handleRoleChange}>
            <MenuItem value="admin">Admin</MenuItem>
            <MenuItem value="instructor">Instructor</MenuItem>
            <MenuItem value="staff">Staff</MenuItem>
            <MenuItem value="student">Student</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id="person-programs-label" shrink>
            Programs
          </InputLabel>
          <Select
            multiple
            labelId="person-programs-label"
            value={programIds}
            label="Programs"
            onChange={handleProgramChange}
            displayEmpty
            notched
            renderValue={(selected) =>
              selected.length === 0 ? (
                <Typography color="text.secondary">All Programs</Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((id) => {
                    const prog = allDropdownPrograms.find((p) => p.id === id)
                    return (
                      <Chip
                        key={id}
                        label={prog?.name ?? `Program #${id}`}
                        size="small"
                        color={prog?.deleted ? 'default' : 'primary'}
                      />
                    )
                  })}
                </Box>
              )
            }
          >
            {allDropdownPrograms.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            {role === 'student'
              ? 'Select one or more programs to restrict access'
              : role === 'staff'
                ? 'Programs do not restrict staff — staff can view all content'
                : 'Instructors and admins can see all content regardless of program assignment'}
          </FormHelperText>
        </FormControl>
        <FormControlLabel
          control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
          label={active ? 'Account active' : 'Account inactive'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSave}
          startIcon={
            saving ? (
              <CircularProgress size={16} color="inherit" aria-label="Saving person" />
            ) : undefined
          }
        >
          {isEdit ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
      <Dialog
        open={clearOpen && !selfProfile}
        onClose={saving ? undefined : () => setClearOpen(false)}
        aria-labelledby="clear-password-title"
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="clear-password-title">Clear password?</DialogTitle>
        <DialogContent>
          <Typography>
            This clears the guest's password; send them a new setup link. It also clears the
            requirement to change their password on next login.
          </Typography>
          {saveError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {saveError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setClearOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={saving}
            onClick={async () => {
              if (!onClearPassword || selfProfile) return
              setSaving(true)
              onSavingChange?.(true)
              setSaveError(null)
              try {
                await onClearPassword()
                setClearOpen(false)
              } catch (err) {
                setSaveError(userMessage(err, 'Could not clear the password. Please retry.'))
              } finally {
                setSaving(false)
                onSavingChange?.(false)
              }
            }}
          >
            Clear password
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default function AddEditPersonModal({
  open,
  onClose,
  onSave,
  programs,
  user,
  onClearPassword,
  selfProfile = false,
}: AddEditPersonModalProps) {
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset save state on reopen
    if (open) setSaving(false)
  }, [open])
  // Use key to reset form state when the modal opens or the user changes
  const formKey = user ? `edit-${user.id}` : 'add'

  return (
    <Dialog
      open={open}
      aria-labelledby="person-form-title"
      onClose={saving ? undefined : onClose}
      disableEscapeKeyDown={saving}
      maxWidth="xs"
      fullWidth
    >
      <AddEditPersonForm
        key={open ? formKey : 'closed'}
        onClose={onClose}
        onSave={onSave}
        onClearPassword={onClearPassword}
        selfProfile={selfProfile}
        onSavingChange={setSaving}
        programs={programs}
        user={user}
      />
    </Dialog>
  )
}
