import { useContext, useState, useRef, useCallback, useMemo } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import { ApiError, userMessage } from '../api'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { AuthContext } from '../authContextValue'
import type { Group, Program } from '../types'
import { getAttachableProgramIds } from '../programAttach'
import { getInheritedRestrictionSx } from '../restrictionStyles'

const filter = createFilterOptions<string>()
const EMPTY_IDS: number[] = []

interface AddCategoryDialogProps {
  open: boolean
  onClose: () => void
  onAdd: (label: string, programIds: number[], groupIds: number[]) => void | Promise<void>
  parentLabel?: string
  siblingNames?: string[]
  programs?: Program[]
  /** Effective inherited program IDs from ancestors (narrowing semantics). */
  inheritedProgramIds?: number[]
  groups?: Group[]
  /** Effective inherited group IDs from ancestors (narrowing semantics). */
  inheritedGroupIds?: number[]
}

export default function AddCategoryDialog({
  open,
  onClose,
  onAdd,
  parentLabel,
  siblingNames = [],
  programs = [],
  inheritedProgramIds = EMPTY_IDS,
  groups = [],
  inheritedGroupIds = EMPTY_IDS,
}: AddCategoryDialogProps) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [visibility, setVisibility] = useState<'all' | 'specific'>('all')
  const [selectedProgramIds, setSelectedProgramIds] = useState<Set<number>>(new Set())
  const [groupVisibility, setGroupVisibility] = useState<'all' | 'specific'>('all')
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const auth = useContext(AuthContext)
  const restrictProgramIds = getAttachableProgramIds(auth?.currentUser ?? null)

  // Pre-populate with parent restrictions when dialog opens (render-time adjustment)
  const [prevDialogOpen, setPrevDialogOpen] = useState(false)
  if (open && !prevDialogOpen) {
    setLabel('')
    setError(null)
    setSaving(false)
    if (inheritedProgramIds.length > 0) {
      setVisibility('specific')
      setSelectedProgramIds(new Set(inheritedProgramIds))
    } else {
      setVisibility('all')
      setSelectedProgramIds(new Set())
    }
    if (inheritedGroupIds.length > 0) {
      setGroupVisibility('specific')
      setSelectedGroupIds(new Set(inheritedGroupIds))
    } else {
      setGroupVisibility('all')
      setSelectedGroupIds(new Set())
    }
  }
  if (open !== prevDialogOpen) setPrevDialogOpen(open)

  const exactMatch = useMemo(
    () => siblingNames.some((s) => s.toLowerCase() === label.trim().toLowerCase()),
    [siblingNames, label],
  )

  const handleEntered = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  const handleClose = () => {
    setLabel('')
    setError(null)
    setVisibility('all')
    setSelectedProgramIds(new Set())
    setGroupVisibility('all')
    setSelectedGroupIds(new Set())
    onClose()
  }

  const toggleProgram = (programId: number) => {
    setSelectedProgramIds((prev) => {
      const next = new Set(prev)
      if (next.has(programId)) {
        next.delete(programId)
      } else {
        next.add(programId)
      }
      return next
    })
  }

  const toggleGroup = (groupId: number) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const programRestricted = visibility === 'specific' && selectedProgramIds.size > 0
  const groupRestricted = groupVisibility === 'specific' && selectedGroupIds.size > 0
  // Only surface the membership caption when a chip is disabled *specifically*
  // because of membership. When ancestor restrictions exist, non-inherited
  // chips are already disabled by the narrowing rule, so the inheritance
  // context — not membership — is the reason.
  const membershipRestrictedProgram = useMemo(
    () =>
      inheritedProgramIds.length === 0 &&
      restrictProgramIds != null &&
      programs.some((p) => !restrictProgramIds.includes(p.id)),
    [inheritedProgramIds, programs, restrictProgramIds],
  )

  const handleSubmit = async () => {
    const trimmed = label.trim()
    if (!trimmed) return
    const programIds = visibility === 'specific' ? Array.from(selectedProgramIds) : []
    const groupIds = groupVisibility === 'specific' ? Array.from(selectedGroupIds) : []
    setSaving(true)
    setError(null)
    try {
      await onAdd(trimmed, programIds, groupIds)
      setLabel('')
      setVisibility('all')
      setSelectedProgramIds(new Set())
      setGroupVisibility('all')
      setSelectedGroupIds(new Set())
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('A category with this name already exists at this level')
      } else {
        setError(userMessage(err, 'Failed to add category.'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      TransitionProps={{ onEntered: handleEntered }}
    >
      <DialogTitle>{parentLabel ? `New Category in ${parentLabel}` : 'New Category'}</DialogTitle>
      <DialogContent>
        <Autocomplete
          freeSolo
          options={siblingNames}
          filterOptions={(options, state) => {
            if (!state.inputValue) return []
            return filter(options, state)
          }}
          inputValue={label}
          onInputChange={(_e, value, reason) => {
            if (reason !== 'reset') setLabel(value)
          }}
          disableClearable
          renderInput={(params) => (
            <TextField
              {...params}
              inputRef={inputRef}
              autoFocus
              margin="dense"
              label="Category name"
              fullWidth
              variant="outlined"
              helperText={exactMatch ? 'This name already exists at this level' : undefined}
              error={exactMatch}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleSubmit()
                }
              }}
            />
          )}
        />
        {programs.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Visible to
            </Typography>
            <RadioGroup
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'all' | 'specific')}
            >
              <FormControlLabel value="all" control={<Radio size="small" />} label="All students" />
              <FormControlLabel
                value="specific"
                control={<Radio size="small" />}
                label="Specific programs"
              />
            </RadioGroup>
            {visibility === 'specific' && (
              <>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                  {programs.map((p) => {
                    const inheritedDisabled =
                      inheritedProgramIds.length > 0 && !inheritedProgramIds.includes(p.id)
                    const disabled =
                      inheritedDisabled ||
                      (restrictProgramIds != null &&
                        !restrictProgramIds.includes(p.id) &&
                        !inheritedProgramIds.includes(p.id))
                    const isInheritedOnly =
                      inheritedProgramIds.includes(p.id) && !selectedProgramIds.has(p.id)
                    return (
                      <Chip
                        key={p.id}
                        label={p.name}
                        size="small"
                        color={
                          selectedProgramIds.has(p.id) || isInheritedOnly ? 'primary' : 'default'
                        }
                        variant={
                          selectedProgramIds.has(p.id) || isInheritedOnly ? 'filled' : 'outlined'
                        }
                        onClick={disabled ? undefined : () => toggleProgram(p.id)}
                        disabled={disabled}
                        sx={getInheritedRestrictionSx(isInheritedOnly)}
                      />
                    )
                  })}
                </Box>
                {membershipRestrictedProgram && (
                  <Typography variant="caption" color="text.secondary">
                    You can only restrict to programs you belong to.
                  </Typography>
                )}
              </>
            )}
          </Box>
        )}
        {groups.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Group restriction
            </Typography>
            <RadioGroup
              value={groupVisibility}
              onChange={(e) => setGroupVisibility(e.target.value as 'all' | 'specific')}
            >
              <FormControlLabel value="all" control={<Radio size="small" />} label="All groups" />
              <FormControlLabel
                value="specific"
                control={<Radio size="small" />}
                label="Specific groups"
              />
            </RadioGroup>
            {groupVisibility === 'specific' && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                {groups.map((g) => {
                  const disabled = inheritedGroupIds.length > 0 && !inheritedGroupIds.includes(g.id)
                  const isInheritedOnly =
                    inheritedGroupIds.includes(g.id) && !selectedGroupIds.has(g.id)
                  const isSelected = selectedGroupIds.has(g.id)
                  const isActive = isSelected || isInheritedOnly
                  return (
                    <Chip
                      key={g.id}
                      label={g.name}
                      size="small"
                      color={isActive ? 'secondary' : undefined}
                      variant={isActive ? 'filled' : 'outlined'}
                      onClick={disabled ? undefined : () => toggleGroup(g.id)}
                      disabled={disabled}
                      sx={getInheritedRestrictionSx(isInheritedOnly)}
                    />
                  )
                })}
              </Box>
            )}
          </Box>
        )}
        {programRestricted && groupRestricted && (
          <Alert severity="info" sx={{ mt: 2 }}>
            This category is restricted by both program and group. A student must be in a listed
            program <strong>and</strong> a listed group to see it.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={
            !label.trim() ||
            (visibility === 'specific' && selectedProgramIds.size === 0) ||
            (groupVisibility === 'specific' && selectedGroupIds.size === 0) ||
            saving
          }
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}
