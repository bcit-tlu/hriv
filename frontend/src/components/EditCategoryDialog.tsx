import { useState, useEffect, useRef, useMemo } from 'react'
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
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import type { Group, Program } from '../types'
import { getVisibilityColors } from '../theme'
import { useColorMode } from '../useColorMode'
import { getInheritedRestrictionSx } from '../restrictionStyles'

const filter = createFilterOptions<string>()

interface EditCategoryDialogProps {
  open: boolean
  onClose: () => void
  onSave: (
    newLabel: string,
    programIds?: number[],
    groupIds?: number[],
    status?: 'active' | 'hidden',
  ) => void | Promise<void>
  currentLabel: string
  siblingNames?: string[]
  programs?: Program[]
  currentProgramIds?: number[]
  /** Program IDs inherited from ancestor categories (read-only display). */
  inheritedProgramIds?: number[]
  groups?: Group[]
  currentGroupIds?: number[]
  /** Group IDs inherited from ancestor categories (read-only display). */
  inheritedGroupIds?: number[]
  /** Current visibility status of the category being edited. */
  categoryStatus?: string | null
  /** Whether an ancestor category is hidden (inherited hidden state). */
  ancestorHidden?: boolean
  /** The ID of the category being edited. */
  categoryId?: number
}

export default function EditCategoryDialog({
  open,
  onClose,
  onSave,
  currentLabel,
  siblingNames = [],
  programs = [],
  currentProgramIds = [],
  inheritedProgramIds = [],
  groups = [],
  currentGroupIds = [],
  inheritedGroupIds = [],
  categoryStatus,
  ancestorHidden = false,
  categoryId,
}: EditCategoryDialogProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [visibility, setVisibility] = useState<'all' | 'specific'>('all')
  const [selectedProgramIds, setSelectedProgramIds] = useState<Set<number>>(new Set())
  const [groupVisibility, setGroupVisibility] = useState<'all' | 'specific'>('all')
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())
  const [statusHidden, setStatusHidden] = useState(false)

  // Populate state from props when dialog opens (false → true transition only)
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setLabel(currentLabel)
      setError(null)
      setVisibility(currentProgramIds.length > 0 || inheritedProgramIds.length > 0 ? 'specific' : 'all')
      // When ancestor restrictions exist, filter out any selected programs
      // that aren't in the inherited set (they'd be unreachable anyway).
      const validIds = inheritedProgramIds.length > 0
        ? currentProgramIds.filter((id) => inheritedProgramIds.includes(id))
        : currentProgramIds
      setSelectedProgramIds(new Set(validIds))
      setGroupVisibility(currentGroupIds.length > 0 || inheritedGroupIds.length > 0 ? 'specific' : 'all')
      const validGroupIds = inheritedGroupIds.length > 0
        ? currentGroupIds.filter((id) => inheritedGroupIds.includes(id))
        : currentGroupIds
      setSelectedGroupIds(new Set(validGroupIds))
      setStatusHidden(categoryStatus === 'hidden')
    }
    prevOpen.current = open
  }, [open, currentLabel, currentProgramIds, inheritedProgramIds, currentGroupIds, inheritedGroupIds, categoryStatus])

  const exactMatch = useMemo(
    () =>
      label.trim().toLowerCase() !== currentLabel.toLowerCase() &&
      siblingNames.some((s) => s.toLowerCase() === label.trim().toLowerCase()),
    [siblingNames, label, currentLabel],
  )

  const handleClose = () => {
    setLabel('')
    setError(null)
    setVisibility('all')
    setSelectedProgramIds(new Set())
    setGroupVisibility('all')
    setSelectedGroupIds(new Set())
    setStatusHidden(false)
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

  const programsChanged = useMemo(() => {
    // Use the same filtered baseline that was used to initialize selectedProgramIds,
    // so that filtering out unreachable programs on open doesn't count as a change.
    const baseline = inheritedProgramIds.length > 0
      ? currentProgramIds.filter((id) => inheritedProgramIds.includes(id))
      : currentProgramIds
    const currentSet = new Set(baseline)
    const effectiveIds = visibility === 'specific' ? selectedProgramIds : new Set<number>()
    if (currentSet.size !== effectiveIds.size) return true
    for (const id of effectiveIds) {
      if (!currentSet.has(id)) return true
    }
    return false
  }, [currentProgramIds, inheritedProgramIds, selectedProgramIds, visibility])

  const groupsChanged = useMemo(() => {
    const baseline = inheritedGroupIds.length > 0
      ? currentGroupIds.filter((id) => inheritedGroupIds.includes(id))
      : currentGroupIds
    const currentSet = new Set(baseline)
    const effectiveIds = groupVisibility === 'specific' ? selectedGroupIds : new Set<number>()
    if (currentSet.size !== effectiveIds.size) return true
    for (const id of effectiveIds) {
      if (!currentSet.has(id)) return true
    }
    return false
  }, [currentGroupIds, inheritedGroupIds, selectedGroupIds, groupVisibility])

  const statusChanged = statusHidden !== (categoryStatus === 'hidden')

  const programRestricted = visibility === 'specific' && selectedProgramIds.size > 0
  const groupRestricted = groupVisibility === 'specific' && selectedGroupIds.size > 0

  const handleSubmit = async () => {
    const trimmed = label.trim()
    if (!trimmed) return
    const labelChanged = trimmed !== currentLabel
    if (!labelChanged && !programsChanged && !groupsChanged && !statusChanged) return
    const programIds = programs.length > 0
      ? (visibility === 'specific' ? Array.from(selectedProgramIds) : [])
      : undefined
    const groupIds = groups.length > 0
      ? (groupVisibility === 'specific' ? Array.from(selectedGroupIds) : [])
      : undefined
    const status = statusChanged ? (statusHidden ? 'hidden' : 'active') : undefined
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed, programIds, groupIds, status)
      setLabel('')
      setVisibility('all')
      setSelectedProgramIds(new Set())
      setGroupVisibility('all')
      setSelectedGroupIds(new Set())
      setStatusHidden(false)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('A category with this name already exists at this level')
      } else {
        setError(userMessage(err, 'Failed to rename category.'))
      }
    } finally {
      setSaving(false)
    }
  }

  const labelChanged = label.trim() !== '' && label.trim() !== currentLabel

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Edit Category
        {categoryId != null && (() => {
          if (ancestorHidden) {
            return (
              <Button
                variant="text"
                size="small"
                startIcon={<VisibilityOff />}
                disabled
                aria-label="Visibility: Hidden by parent category"
                sx={{ '&.Mui-disabled': { color: visColors.inactive }, filter: 'grayscale(100%)' }}
              >
                Hidden by Parent
              </Button>
            )
          }
          if (statusHidden) {
            return (
              <Button
                variant="text"
                size="small"
                startIcon={<VisibilityOff />}
                onClick={() => setStatusHidden(false)}
                aria-label="Visibility: Show category"
                sx={{ color: visColors.inactive, filter: 'grayscale(100%)' }}
              >
                Show Category
              </Button>
            )
          }
          return (
            <Button
              variant="text"
              size="small"
              startIcon={<Visibility />}
              onClick={() => setStatusHidden(true)}
              aria-label="Visibility: Hide category"
              color="primary"
            >
              Hide Category
            </Button>
          )
        })()}
      </DialogTitle>
      <DialogContent>
        <Autocomplete
          freeSolo
          options={siblingNames}
          filterOptions={(options, state) => {
            if (!state.inputValue) return []
            return filter(options, state).filter(
              (o) => o.toLowerCase() !== currentLabel.toLowerCase(),
            )
          }}
          inputValue={label}
          onInputChange={(_e, value, reason) => {
            if (reason !== 'reset') setLabel(value)
          }}
          disableClearable
          renderInput={(params) => (
            <TextField
              {...params}
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
              Restrict access by program
            </Typography>
            <RadioGroup
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'all' | 'specific')}
            >
              <FormControlLabel value="all" control={<Radio size="small" />} label="All programs" />
              <FormControlLabel value="specific" control={<Radio size="small" />} label="Specific programs" />
            </RadioGroup>
            {visibility === 'specific' && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                {programs.map((p) => {
                  const disabled = inheritedProgramIds.length > 0 && !inheritedProgramIds.includes(p.id)
                  const isInheritedOnly = inheritedProgramIds.includes(p.id) && !selectedProgramIds.has(p.id)
                  return (
                    <Chip
                      key={p.id}
                      label={p.name}
                      size="small"
                      color={selectedProgramIds.has(p.id) || isInheritedOnly ? 'primary' : 'default'}
                      variant={selectedProgramIds.has(p.id) || isInheritedOnly ? 'filled' : 'outlined'}
                      onClick={disabled ? undefined : () => toggleProgram(p.id)}
                      disabled={disabled}
                      sx={getInheritedRestrictionSx(isInheritedOnly)}
                    />
                  )
                })}
              </Box>
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
              <FormControlLabel value="specific" control={<Radio size="small" />} label="Specific groups" />
            </RadioGroup>
            {groupVisibility === 'specific' && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                {groups.map((g) => {
                  const disabled = inheritedGroupIds.length > 0 && !inheritedGroupIds.includes(g.id)
                  const isInheritedOnly = inheritedGroupIds.includes(g.id) && !selectedGroupIds.has(g.id)
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
            This category is restricted by both program and group. A student must
            be in a listed program <strong>and</strong> a listed group to see it.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!label.trim() || (!labelChanged && !programsChanged && !groupsChanged && !statusChanged) || (visibility === 'specific' && selectedProgramIds.size === 0 && programs.length > 0 && inheritedProgramIds.length === 0) || (groupVisibility === 'specific' && selectedGroupIds.size === 0 && groups.length > 0 && inheritedGroupIds.length === 0) || saving}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
