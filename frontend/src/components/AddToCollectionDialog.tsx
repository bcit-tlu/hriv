import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { AuthContext } from '../authContextValue'
import {
  COLLECTIONS_AT_CAP_TOOLTIP,
  COLLECTION_TYPE_LABELS,
  collectionImageCap,
  STUDENT_SEQUENCE_MAX_IMAGES,
  studentTypesAtCap,
  SYNCHRONIZED_MAX_IMAGES,
} from '../collectionUtils'
import type { CollectionSummary, Group, Program } from '../types'
import CollectionEditDialog, { type CollectionFormValues } from './CollectionEditDialog'

export interface AddToCollectionDialogProps {
  open: boolean
  onClose: () => void
  /** Images to add; the viewer passes one, multi-select (#1418) passes many. */
  imageIds: number[]
  /** Collections the caller may edit (`useEditableCollections`). */
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
  programs?: Program[]
  groups?: Group[]
  /**
   * Add the images to `collection`. Resolve `true` to close the dialog; resolve
   * `false` to keep it open (the caller has already reported the outcome).
   */
  onAdd: (collection: CollectionSummary) => Promise<boolean>
  /** Create a new collection holding the images; reject to show the message in the form. */
  onCreate: (values: CollectionFormValues) => Promise<void>
}

interface CollectionGroup {
  key: 'mine' | 'program' | 'other'
  label: string
  items: CollectionSummary[]
}

export const CAP_REACHED_TOOLTIP = `Synchronized collections hold at most ${SYNCHRONIZED_MAX_IMAGES} images.`
const STUDENT_SEQUENCE_CAP_REACHED_TOOLTIP = `Students can add at most ${STUDENT_SEQUENCE_MAX_IMAGES} images to a sequence collection.`

export default function AddToCollectionDialog({
  open,
  onClose,
  imageIds,
  collections,
  loading,
  error,
  programs = [],
  groups = [],
  onAdd,
  onCreate,
}: AddToCollectionDialogProps) {
  const auth = useContext(AuthContext)
  const currentUser = auth?.currentUser ?? null
  const typesAtLimit = studentTypesAtCap(collections, currentUser)
  const bothTypesAtLimit = typesAtLimit.size === 2
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const prevOpen = useRef(false)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setQuery('')
      setBusyId(null)
      setCreateOpen(false)
    }
    prevOpen.current = open
  }, [open])

  const sections = useMemo<CollectionGroup[]>(() => {
    const needle = query.trim().toLowerCase()
    const matching = collections.filter(
      (c) => needle.length === 0 || c.name.toLowerCase().includes(needle),
    )
    const mine: CollectionSummary[] = []
    const program: CollectionSummary[] = []
    const other: CollectionSummary[] = []
    for (const c of matching) {
      if (c.owners.some((o) => o.kind === 'user' && o.userId === currentUser?.id)) mine.push(c)
      else if (c.owners.some((o) => o.kind === 'program')) program.push(c)
      else other.push(c)
    }
    return [
      { key: 'mine' as const, label: 'My collections', items: mine },
      { key: 'program' as const, label: 'Program collections', items: program },
      { key: 'other' as const, label: 'Other collections', items: other },
    ].filter((s) => s.items.length > 0)
  }, [collections, currentUser?.id, query])

  const busy = busyId !== null
  const imageWord = imageIds.length === 1 ? 'image' : `${imageIds.length} images`

  const handlePick = async (collection: CollectionSummary) => {
    if (busy) return
    setBusyId(collection.id)
    try {
      const done = await onAdd(collection)
      if (done) onClose()
    } finally {
      setBusyId(null)
    }
  }

  const handleCreate = async (values: CollectionFormValues) => {
    await onCreate(values)
    setCreateOpen(false)
    onClose()
  }

  const showEmpty = !loading && !error && collections.length === 0
  const showNoMatch = !loading && !error && collections.length > 0 && sections.length === 0

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? undefined : onClose}
        maxWidth="xs"
        fullWidth
        TransitionProps={{
          // Skip the filter autofocus if the create dialog already opened on
          // top, otherwise it would pull focus away from the nested form.
          onEntered: () => {
            if (!createOpen) inputRef.current?.focus()
          },
        }}
        aria-labelledby="add-to-collection-title"
      >
        <DialogTitle id="add-to-collection-title">Add to Collection</DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Choose a collection for this {imageWord}.
          </Typography>
          <TextField
            inputRef={inputRef}
            size="small"
            fullWidth
            placeholder="Filter collections"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading || collections.length === 0}
            slotProps={{
              htmlInput: { 'aria-label': 'Filter collections' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box sx={{ minHeight: 160, maxHeight: 360, overflowY: 'auto', mt: 1 }}>
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={28} aria-label="Loading collections" />
              </Box>
            )}
            {!loading && error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}
            {showEmpty && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 3, textAlign: 'center' }}
              >
                You don't have a collection you can add to yet.
              </Typography>
            )}
            {showNoMatch && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 3, textAlign: 'center' }}
              >
                No collections match “{query.trim()}”.
              </Typography>
            )}
            {!loading &&
              !error &&
              sections.map((section) => (
                <List
                  key={section.key}
                  dense
                  disablePadding
                  aria-label={section.label}
                  subheader={
                    <ListSubheader disableSticky disableGutters sx={{ lineHeight: '32px' }}>
                      {section.label}
                    </ListSubheader>
                  }
                >
                  {section.items.map((collection) => {
                    const cap = collectionImageCap(collection.type, currentUser?.role)
                    const full = cap != null && collection.imageCount >= cap
                    const disabled = full || busy
                    const fullTooltip =
                      collection.type === 'synchronized'
                        ? CAP_REACHED_TOOLTIP
                        : STUDENT_SEQUENCE_CAP_REACHED_TOOLTIP
                    const countText = `${collection.imageCount} ${
                      collection.imageCount === 1 ? 'image' : 'images'
                    }`
                    return (
                      <ListItem key={collection.id} disablePadding>
                        <Tooltip title={full ? fullTooltip : ''}>
                          <span style={{ display: 'block', width: '100%' }}>
                            <ListItemButton
                              disabled={disabled}
                              onClick={() => void handlePick(collection)}
                              aria-label={`Add to ${collection.name}`}
                              sx={{ borderRadius: 1 }}
                            >
                              <ListItemText
                                primary={collection.name}
                                secondary={countText}
                                slotProps={{
                                  primary: { noWrap: true },
                                  secondary: { noWrap: true },
                                }}
                              />
                              {busyId === collection.id ? (
                                <CircularProgress size={18} sx={{ ml: 1 }} />
                              ) : (
                                <Chip
                                  label={COLLECTION_TYPE_LABELS[collection.type]}
                                  size="small"
                                  variant="outlined"
                                  color="primary"
                                  sx={{ ml: 1 }}
                                />
                              )}
                            </ListItemButton>
                          </span>
                        </Tooltip>
                      </ListItem>
                    )
                  })}
                </List>
              ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Tooltip title={bothTypesAtLimit ? COLLECTIONS_AT_CAP_TOOLTIP : ''}>
            <span>
              <Button
                startIcon={<AddIcon />}
                onClick={() => setCreateOpen(true)}
                disabled={busy || bothTypesAtLimit}
              >
                New collection…
              </Button>
            </span>
          </Tooltip>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
      <CollectionEditDialog
        open={open && createOpen}
        onClose={() => setCreateOpen(false)}
        collection={null}
        programs={programs}
        groups={groups}
        typesAtLimit={typesAtLimit}
        onSave={handleCreate}
      />
    </>
  )
}
