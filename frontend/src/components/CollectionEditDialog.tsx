import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import { collectionConflictCurrent, userMessage } from '../api'
import { AuthContext } from '../authContextValue'
import {
  COLLECTION_TYPE_LABELS,
  COLLECTION_VISIBILITY_LABELS,
  SYNCHRONIZED_MAX_IMAGES,
  apiCollectionToCollection,
  canUseRestrictedVisibility,
} from '../collectionUtils'
import { getAttachableProgramIds } from '../programAttach'
import { getVisibilityColors } from '../theme'
import { isCategoryHiddenInTree } from '../treeUtils'
import { useColorMode } from '../useColorMode'
import CategoryPickerSelect from './CategoryPickerSelect'
import type {
  Category,
  Collection,
  CollectionType,
  CollectionVisibility,
  Group,
  Program,
} from '../types'

const EMPTY_PROGRAMS: Program[] = []
const EMPTY_GROUPS: Group[] = []

export interface CollectionFormValues {
  name: string
  description: string | null
  type: CollectionType
  visibility: CollectionVisibility
  /** Only populated when `visibility === 'restricted'` (the API 422s otherwise). */
  programIds: number[]
  groupIds: number[]
  /**
   * Category filing for edits (#1566): not a PATCH field — the caller turns a
   * change into `POST …/move`. Always carries the collection's current
   * category so an unchanged save is a no-op; `null` = Browse root.
   */
  categoryId: number | null
  /**
   * Curatorial hide (#1566): toggled by the Hide link in the title — the same
   * form-field pattern EditImageModal/EditCategoryDialog use, so it persists
   * on Save rather than immediately.
   */
  hidden: boolean
}

export interface CollectionEditDialogProps {
  open: boolean
  onClose: () => void
  /** Existing collection to edit (type is locked). Omit / null to create a new one. */
  collection?: Collection | null
  /**
   * Initial type for a new collection (#1554) — callers pass the type page /
   * facet the dialog was opened from so a create lands in the list the user
   * is looking at. Ignored when editing.
   */
  defaultType?: CollectionType
  programs?: Program[]
  groups?: Group[]
  /**
   * Persist the form. `version` is the optimistic-concurrency token for edits
   * (null on create). `baseline` is the record the form was seeded from (the
   * authoritative copy after a conflict reload) so callers can send only the
   * changed fields. Rejections are shown inside the dialog via `userMessage`;
   * a stale-version 409 additionally offers to reload the current values.
   */
  onSave: (
    values: CollectionFormValues,
    version: number | null,
    baseline: Collection | null,
  ) => Promise<void>
  /**
   * Delete affordance inside the dialog (#1554) — mirrors EditImageModal's
   * click-to-confirm button. Callers close the dialog on success; rejections
   * surface in the dialog's error alert.
   */
  onDelete?: () => Promise<void>
  /**
   * Browse category tree (#1566): renders the CategoryPickerSelect on edits
   * when the caller can file collections, and resolves the "Hidden by
   * Category" state of the title's Hide link.
   */
  categories?: Category[]
  onAddCategory?: (
    label: string,
    parentId: number | null,
    programIds?: number[],
    groupIds?: number[],
  ) => Promise<number | void>
  onEditCategory?: (
    categoryId: number,
    newLabel: string,
    programIds?: number[],
    groupIds?: number[],
  ) => Promise<void>
  onToggleVisibility?: (categoryId: number) => Promise<void>
}

const TYPE_HELP: Record<CollectionType, string> = {
  synchronized: `Up to ${SYNCHRONIZED_MAX_IMAGES} images viewed side by side with a shared viewport.`,
  sequence: 'An ordered set of images stepped through one at a time.',
}

export default function CollectionEditDialog({
  open,
  onClose,
  collection = null,
  defaultType = 'sequence',
  programs = EMPTY_PROGRAMS,
  groups = EMPTY_GROUPS,
  onSave,
  onDelete,
  categories = [],
  onAddCategory,
  onEditCategory,
  onToggleVisibility,
}: CollectionEditDialogProps) {
  const isEdit = collection != null
  const auth = useContext(AuthContext)
  const currentUser = auth?.currentUser ?? null
  const canRestrict = canUseRestrictedVisibility(currentUser?.role)
  // Filing into a category is curatorial (admin/instructor), matching the
  // move endpoint's authority — owners of other roles get no picker (#1566).
  const canFile = currentUser?.role === 'admin' || currentUser?.role === 'instructor'
  // Metadata writes are owner-scoped (#1567): a curator opening the dialog
  // only to refile/hide gets the picker and the hide link, not the fields a
  // PATCH would 403 on.
  const canEditMeta = !isEdit || (collection?.permissions.canEdit ?? false)
  // Field-level authz (#1531): editing metadata is owner/editor-level, but
  // changing visibility scope requires `can_change_scope`. On create the
  // creator always sets the initial scope.
  const canChangeScope = !isEdit || (collection?.permissions.canChangeScope ?? false)
  const attachableProgramIds = getAttachableProgramIds(currentUser)

  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<CollectionType>('sequence')
  const [visibility, setVisibility] = useState<CollectionVisibility>('private')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [hidden, setHidden] = useState(false)
  const [selectedProgramIds, setSelectedProgramIds] = useState<Set<number>>(new Set())
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())
  const [version, setVersion] = useState<number | null>(null)
  const [baseline, setBaseline] = useState<Collection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Collection | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const seedFrom = (source: Collection | null) => {
    setName(source?.name ?? '')
    setDescription(source?.description ?? '')
    setType(source?.type ?? defaultType)
    setVisibility(source?.visibility ?? 'private')
    setCategoryId(source?.categoryId ?? null)
    setHidden(source?.hidden ?? false)
    setSelectedProgramIds(new Set(source?.programIds ?? []))
    setSelectedGroupIds(new Set(source?.groupIds ?? []))
    setVersion(source?.version ?? null)
    setBaseline(source)
    setError(null)
    setConflict(null)
    setSaving(false)
    setConfirmDelete(false)
    setDeleting(false)
  }

  // Populate state from props when dialog opens (false → true transition only),
  // same pattern as EditCategoryDialog.
  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) seedFrom(collection)
    prevOpen.current = open
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seedFrom captures defaultType at open time
  }, [open, collection])

  // A save that partially succeeded (metadata PATCH ok, chained category move
  // failed) returns a newer record while the dialog stays open (#1567):
  // advance baseline/version to the saved state so a retry diffs against it
  // instead of replaying a stale-version PATCH. Field values are deliberately
  // NOT reseeded — the user's in-progress edits (like the category pick) stay.
  useEffect(() => {
    if (!open || !collection || !baseline) return
    if (collection.id !== baseline.id || collection.version <= baseline.version) return
    setVersion(collection.version)
    setBaseline(collection)
  }, [open, collection, baseline])

  const handleEntered = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  const toggleProgram = (programId: number) => {
    setSelectedProgramIds((prev) => {
      const next = new Set(prev)
      if (next.has(programId)) next.delete(programId)
      else next.add(programId)
      return next
    })
  }

  const toggleGroup = (groupId: number) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  // Attach authority mirrors the category dialogs: instructors may only add
  // programs they belong to and groups they manage; anything already attached
  // stays toggleable so any editor can narrow or drop scope.
  const currentProgramIds = baseline?.programIds ?? []
  const currentGroupIds = baseline?.groupIds ?? []
  const isProgramDisabled = (programId: number) =>
    !canEditMeta ||
    !canChangeScope ||
    (attachableProgramIds != null &&
      !attachableProgramIds.includes(programId) &&
      !currentProgramIds.includes(programId))
  const isGroupDisabled = (group: Group) =>
    !canEditMeta ||
    !canChangeScope ||
    (currentUser?.role === 'instructor' &&
      !group.instructorIds.includes(currentUser.id) &&
      !currentGroupIds.includes(group.id))
  const membershipRestrictedProgram = programs.some((p) => isProgramDisabled(p.id))
  const managementRestrictedGroup = groups.some((g) => isGroupDisabled(g))

  const restricted = visibility === 'restricted'
  const scopeMissing = restricted && selectedProgramIds.size === 0 && selectedGroupIds.size === 0
  const canSubmit = name.trim().length > 0 && !scopeMissing && !saving && !deleting
  // A collection filed inside a hidden category is hidden by ancestry, so its
  // own hide control is disabled — the EditImageModal convention (#1566).
  const categoryHidden = isEdit && isCategoryHiddenInTree(categories, categoryId)
  const showHideControl = isEdit && collection?.permissions.canHide

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!canSubmit) return
    const values: CollectionFormValues = {
      name: trimmed,
      description: description.trim() ? description.trim() : null,
      type,
      visibility,
      programIds: restricted ? Array.from(selectedProgramIds) : [],
      groupIds: restricted ? Array.from(selectedGroupIds) : [],
      categoryId,
      hidden,
    }
    setSaving(true)
    setError(null)
    setConflict(null)
    try {
      await onSave(values, version, baseline)
      onClose()
    } catch (err) {
      const current = collectionConflictCurrent(err)
      if (current) setConflict(apiCollectionToCollection(current))
      setError(
        userMessage(err, isEdit ? 'Failed to update collection.' : 'Failed to create collection.'),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleReloadConflict = () => {
    if (conflict) seedFrom(conflict)
  }

  // Same click-to-confirm delete as EditImageModal: first click arms, second
  // fires; the caller closes the dialog on success.
  const handleDelete = async () => {
    if (!onDelete) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await onDelete()
    } catch (err) {
      setDeleting(false)
      setConfirmDelete(false)
      setError(userMessage(err, 'Failed to delete collection.'))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving || deleting ? undefined : onClose}
      // Roomier than xs so the category picker can show long nested labels
      // (#1566) — same width class as EditImageModal.
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onEntered: handleEntered }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {isEdit ? (canEditMeta ? 'Edit Collection' : 'File Collection') : 'New Collection'}
        {/* Curatorial hide/show as a form field (#1566) — the EditImageModal /
            EditCategoryDialog title-link convention: it toggles local state
            and persists on Save. "Hidden by Category" mirrors the image
            modal's disabled state when the filing category is hidden. */}
        {showHideControl &&
          (categoryHidden ? (
            <Button
              variant="text"
              size="small"
              startIcon={<VisibilityOff />}
              disabled
              aria-label="Visibility: Hidden by category"
              sx={{
                '&.Mui-disabled': { color: visColors.inactive },
                filter: 'grayscale(100%)',
              }}
            >
              Hidden by Category
            </Button>
          ) : hidden ? (
            <Button
              variant="text"
              size="small"
              startIcon={<VisibilityOff />}
              onClick={() => setHidden(false)}
              aria-label="Visibility: Show collection"
              sx={{ color: visColors.inactive, filter: 'grayscale(100%)' }}
            >
              Show Collection
            </Button>
          ) : (
            <Button
              variant="text"
              size="small"
              startIcon={<Visibility />}
              onClick={() => setHidden(true)}
              aria-label="Visibility: Hide collection"
              color="primary"
            >
              Hide Collection
            </Button>
          ))}
      </DialogTitle>
      <DialogContent>
        {!canEditMeta && (
          <Alert severity="info" sx={{ mb: 1 }} data-testid="filing-only-note">
            You can file or hide this collection; only its owner can edit the details.
          </Alert>
        )}
        <TextField
          inputRef={inputRef}
          autoFocus
          margin="dense"
          label="Collection name"
          fullWidth
          variant="outlined"
          value={name}
          disabled={!canEditMeta}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        {/* Category filing sits where EditImageModal puts it — right after
            the name — and only renders for roles the move endpoint allows
            (#1566). The picker's inline add/rename/hide affordances match
            the shared move dialog's. */}
        {isEdit && canFile && (
          <Box sx={{ mt: 1 }}>
            <CategoryPickerSelect
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              onAddCategory={onAddCategory}
              onEditCategory={onEditCategory}
              onToggleVisibility={onToggleVisibility}
              programs={programs}
              groups={groups}
            />
          </Box>
        )}
        <TextField
          margin="dense"
          label="Description"
          fullWidth
          multiline
          minRows={2}
          variant="outlined"
          value={description}
          disabled={!canEditMeta}
          onChange={(e) => setDescription(e.target.value)}
        />

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" component="p" gutterBottom>
            Type
          </Typography>
          {isEdit ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                data-testid="collection-type-chip"
                label={COLLECTION_TYPE_LABELS[type]}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Typography variant="caption" color="text.secondary">
                The type cannot be changed after creation.
              </Typography>
            </Box>
          ) : (
            <RadioGroup
              aria-label="Collection type"
              value={type}
              onChange={(e) => setType(e.target.value as CollectionType)}
            >
              {(Object.keys(COLLECTION_TYPE_LABELS) as CollectionType[]).map((t) => (
                <FormControlLabel
                  key={t}
                  value={t}
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2">{COLLECTION_TYPE_LABELS[t]}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {TYPE_HELP[t]}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'flex-start', mb: 0.5 }}
                />
              ))}
            </RadioGroup>
          )}
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" component="p" gutterBottom>
            Visible to
          </Typography>
          <RadioGroup
            aria-label="Visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as CollectionVisibility)}
          >
            <FormControlLabel
              value="private"
              control={<Radio size="small" />}
              label={`${COLLECTION_VISIBILITY_LABELS.private} — only you`}
              disabled={!canEditMeta || !canChangeScope}
            />
            <FormControlLabel
              value="public"
              control={<Radio size="small" />}
              label={`${COLLECTION_VISIBILITY_LABELS.public} — everyone who can sign in`}
              disabled={!canEditMeta || !canChangeScope}
            />
            {canRestrict && (
              <FormControlLabel
                value="restricted"
                control={<Radio size="small" />}
                label={`${COLLECTION_VISIBILITY_LABELS.restricted} — specific programs and/or groups`}
                disabled={!canEditMeta || !canChangeScope}
              />
            )}
          </RadioGroup>
          {!canChangeScope && (
            <Typography variant="caption" color="text.secondary">
              Only an owner can change who this collection is visible to.
            </Typography>
          )}
        </Box>

        {restricted && canRestrict && (
          <>
            {programs.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" component="p" gutterBottom>
                  Programs
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {programs.map((p) => {
                    const disabled = isProgramDisabled(p.id)
                    const selected = selectedProgramIds.has(p.id)
                    return (
                      <Chip
                        key={p.id}
                        data-testid="program-chip"
                        label={p.name}
                        size="small"
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={disabled ? undefined : () => toggleProgram(p.id)}
                        disabled={disabled}
                      />
                    )
                  })}
                </Box>
                {membershipRestrictedProgram && (
                  <Typography variant="caption" color="text.secondary">
                    You can only restrict to programs you belong to.
                  </Typography>
                )}
              </Box>
            )}
            {groups.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" component="p" gutterBottom>
                  Groups
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {groups.map((g) => {
                    const disabled = isGroupDisabled(g)
                    const selected = selectedGroupIds.has(g.id)
                    return (
                      <Chip
                        key={g.id}
                        data-testid="group-chip"
                        label={g.name}
                        size="small"
                        color={selected ? 'secondary' : undefined}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={disabled ? undefined : () => toggleGroup(g.id)}
                        disabled={disabled}
                      />
                    )
                  })}
                </Box>
                {managementRestrictedGroup && (
                  <Typography variant="caption" color="text.secondary">
                    You can only restrict to groups you manage.
                  </Typography>
                )}
              </Box>
            )}
            {scopeMissing ? (
              <Alert severity="info" sx={{ mt: 2 }}>
                Select at least one program or group, or choose Public instead.
              </Alert>
            ) : (
              selectedProgramIds.size > 0 &&
              selectedGroupIds.size > 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  A student must be in a listed program <strong>and</strong> a listed group to see
                  this collection.
                </Alert>
              )
            )}
          </>
        )}

        {error && (
          <Alert
            severity={conflict ? 'warning' : 'error'}
            sx={{ mt: 2 }}
            onClose={() => setError(null)}
            action={
              conflict ? (
                <Button color="inherit" size="small" onClick={handleReloadConflict}>
                  Reload
                </Button>
              ) : undefined
            }
          >
            {error}
          </Alert>
        )}

        {isEdit && onDelete && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Button
                color="error"
                variant={confirmDelete ? 'contained' : 'outlined'}
                onClick={() => void handleDelete()}
                disabled={saving || deleting}
                fullWidth
              >
                {confirmDelete ? 'Confirm Delete Collection' : 'Delete Collection'}
              </Button>
              {confirmDelete && (
                <Typography
                  variant="caption"
                  color="error"
                  sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
                >
                  The images it references are not deleted. This action cannot be undone.
                </Typography>
              )}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving || deleting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!canSubmit}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
