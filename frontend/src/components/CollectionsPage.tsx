import { useRef, useState, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CollectionsIcon from '@mui/icons-material/Collections'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { userMessage, type ApiImage } from '../api'
import {
  COLLECTION_TYPE_LABELS,
  COLLECTION_VISIBILITY_LABELS,
  describeCollectionOwner,
} from '../collectionUtils'
import type { CollectionListFilters, CollectionOwnerFilter } from '../useCollectionsData'
import type {
  Collection,
  CollectionOwner,
  CollectionSummary,
  CollectionType,
  Group,
  ImageItem,
  Program,
  User,
} from '../types'
import CollectionCard, { CollectionVisibilityChip } from './CollectionCard'
import CollectionEditDialog, { type CollectionFormValues } from './CollectionEditDialog'
import RenewingThumbnail from './RenewingThumbnail'
import SequenceCollectionViewer from './SequenceCollectionViewer'

export interface CollectionsPageProps {
  currentUser: User | null
  programs: Program[]
  groups: Group[]
  /** List state (owned by `useCollectionsData`). */
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
  filters: CollectionListFilters
  onFiltersChange: (filters: CollectionListFilters) => void
  ownerOptions: NonNullable<CollectionOwner>[]
  /** Detail placeholder state; `selectedCollectionId` null renders the list. */
  selectedCollectionId: number | null
  detail: Collection | null
  detailLoading: boolean
  detailError: string | null
  onOpenCollection: (id: number) => void
  onCloseCollection: () => void
  onOpenImage: (image: ImageItem) => void
  /** Sequence viewer state (`?item=` position) and mutations (#1416). */
  selectedCollectionItemId: number | null
  onSelectCollectionItem: (imageId: number) => void
  onReorderImages: (id: number, imageIds: number[]) => Promise<unknown>
  onCollectionImageRenewed: (collectionId: number, image: ApiImage) => void
  onViewerError: (message: string) => void
  /** Mutations — reject with an ApiError to surface the message in the dialog. */
  loadCollection: (id: number) => Promise<Collection>
  onCreate: (values: CollectionFormValues) => Promise<unknown>
  onUpdate: (
    id: number,
    values: CollectionFormValues,
    version: number,
    baseline: Collection | null,
  ) => Promise<unknown>
  onDelete: (id: number) => Promise<void>
}

function ownerFilterKey(owner: CollectionOwnerFilter): string {
  if (owner === 'any' || owner === 'orphaned') return owner
  return owner.kind === 'user' ? `u${owner.userId}` : `p${owner.programId}`
}

/** Shared header for the collection detail views (placeholder + viewers). */
function CollectionDetailHeader({
  collection,
  onBack,
  onEdit,
  onDelete,
}: {
  collection: Collection
  onBack: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  return (
    <>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 1 }}>
        All collections
      </Button>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box>
          <Typography variant="h5" component="h1" sx={{ wordBreak: 'break-word' }}>
            {collection.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {describeCollectionOwner(collection.owner)} · {collection.images.length}{' '}
            {collection.images.length === 1 ? 'image' : 'images'}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            <Chip
              size="small"
              variant="outlined"
              color="primary"
              label={COLLECTION_TYPE_LABELS[collection.type]}
            />
            <CollectionVisibilityChip visibility={collection.visibility} />
          </Box>
          {collection.description && (
            <Typography variant="body1" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
              {collection.description}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {collection.permissions.canEdit && onEdit && (
            <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={onEdit}>
              Edit
            </Button>
          )}
          {collection.permissions.canDelete && onDelete && (
            <Button
              variant="outlined"
              size="small"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={onDelete}
            >
              Delete
            </Button>
          )}
        </Box>
      </Box>
    </>
  )
}

function CollectionDetailPlaceholder({
  collection,
  onBack,
  onOpenImage,
  onEdit,
  onDelete,
}: {
  collection: Collection
  onBack: () => void
  onOpenImage: (image: ImageItem) => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  return (
    <Box data-testid="collection-detail">
      <CollectionDetailHeader
        collection={collection}
        onBack={onBack}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      <Alert severity="info" sx={{ mt: 3 }}>
        The {COLLECTION_TYPE_LABELS[collection.type].toLowerCase()} viewer is coming soon. Until
        then, open each image individually below.
      </Alert>

      {collection.images.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
          This collection has no images yet.
        </Typography>
      ) : (
        <List dense sx={{ mt: 2 }}>
          {collection.images.map((img, index) => (
            <ListItem
              key={img.id}
              divider
              secondaryAction={
                <Button
                  size="small"
                  endIcon={<OpenInNewIcon />}
                  href={`?image=${img.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    onOpenImage(img)
                  }}
                >
                  Open image
                </Button>
              }
            >
              <ListItemAvatar>
                <RenewingThumbnail
                  image={img}
                  alt=""
                  sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1 }}
                />
              </ListItemAvatar>
              <ListItemText primary={`${index + 1}. ${img.name}`} />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  )
}

export default function CollectionsPage({
  currentUser,
  programs,
  groups,
  collections,
  loading,
  error,
  filters,
  onFiltersChange,
  ownerOptions,
  selectedCollectionId,
  detail,
  detailLoading,
  detailError,
  onOpenCollection,
  onCloseCollection,
  onOpenImage,
  selectedCollectionItemId,
  onSelectCollectionItem,
  onReorderImages,
  onCollectionImageRenewed,
  onViewerError,
  loadCollection,
  onCreate,
  onUpdate,
  onDelete,
}: CollectionsPageProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CollectionSummary | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const editRequestRef = useRef(0)

  const isAdmin = currentUser?.role === 'admin'
  const showOwnerFilter = currentUser != null && currentUser.role !== 'student'

  const openCreate = () => {
    // Supersede any Edit fetch still in flight so it cannot replace this form.
    editRequestRef.current++
    setEditLoadError(null)
    setEditing(null)
    setEditorOpen(true)
  }

  const openEdit = async (summary: CollectionSummary) => {
    // Only the most recent Edit click may open the form.
    const request = ++editRequestRef.current
    setEditLoadError(null)
    try {
      // Summaries omit program/group scope, so fetch the full record first.
      const full = detail?.id === summary.id ? detail : await loadCollection(summary.id)
      if (request !== editRequestRef.current) return
      setEditing(full)
      setEditorOpen(true)
    } catch (err) {
      if (request !== editRequestRef.current) return
      setEditLoadError(userMessage(err, 'Failed to load collection.'))
    }
  }

  const requestDelete = (summary: CollectionSummary) => {
    setDeleteTarget(summary)
    setDeleteError(null)
    setDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.id)
      setDeleteOpen(false)
      if (selectedCollectionId === deleteTarget.id) onCloseCollection()
    } catch (err) {
      setDeleteError(userMessage(err, 'Failed to delete collection.'))
    } finally {
      setDeleting(false)
    }
  }

  const handleSave = async (
    values: CollectionFormValues,
    version: number | null,
    baseline: Collection | null,
  ) => {
    if (editing && version != null) {
      await onUpdate(editing.id, values, version, baseline)
    } else {
      await onCreate(values)
    }
  }

  const ownerValue = ownerFilterKey(filters.owner)
  const ownerChoices: { key: string; label: string; value: CollectionOwnerFilter }[] = [
    { key: 'any', label: 'Anyone', value: 'any' },
    ...ownerOptions.map((o) => ({
      key: ownerFilterKey(o),
      label: describeCollectionOwner(o),
      value: o as CollectionOwnerFilter,
    })),
    ...(isAdmin
      ? [{ key: 'orphaned', label: 'No owner (orphaned)', value: 'orphaned' as const }]
      : []),
  ]
  const selectedOwnerKnown = ownerChoices.some((c) => c.key === ownerValue)

  let body: ReactNode
  if (selectedCollectionId != null) {
    if (detailLoading && !detail) {
      body = (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
          <CircularProgress aria-label="Loading collection" />
        </Box>
      )
    } else if (detailError) {
      body = (
        <Box data-testid="collection-detail-error">
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={onCloseCollection}>
                All collections
              </Button>
            }
          >
            {detailError}
          </Alert>
        </Box>
      )
    } else if (detail && detail.type === 'sequence') {
      body = (
        <Box data-testid="collection-detail">
          <CollectionDetailHeader
            collection={detail}
            onBack={onCloseCollection}
            onEdit={() => void openEdit(detail)}
            onDelete={() => requestDelete(detail)}
          />
          <SequenceCollectionViewer
            collection={detail}
            itemId={selectedCollectionItemId}
            onSelectItem={onSelectCollectionItem}
            onOpenImage={onOpenImage}
            onReorder={(imageIds) => onReorderImages(detail.id, imageIds)}
            onImageRenewed={(image) => onCollectionImageRenewed(detail.id, image)}
            onError={onViewerError}
          />
        </Box>
      )
    } else if (detail) {
      body = (
        <CollectionDetailPlaceholder
          collection={detail}
          onBack={onCloseCollection}
          onOpenImage={onOpenImage}
          onEdit={() => void openEdit(detail)}
          onDelete={() => requestDelete(detail)}
        />
      )
    } else {
      body = null
    }
  } else {
    body = (
      <>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            mb: 2,
          }}
        >
          <Typography variant="h5" component="h1">
            Collections
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New collection
          </Button>
        </Box>

        <Box
          data-testid="collection-filters"
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 3 }}
        >
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filters.type}
            aria-label="Collection type"
            onChange={(_e, v: CollectionType | 'all' | null) => {
              if (v != null) onFiltersChange({ ...filters, type: v })
            }}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="synchronized">{COLLECTION_TYPE_LABELS.synchronized}</ToggleButton>
            <ToggleButton value="sequence">{COLLECTION_TYPE_LABELS.sequence}</ToggleButton>
          </ToggleButtonGroup>
          <Chip
            label="My collections"
            clickable
            color={filters.mine ? 'primary' : 'default'}
            variant={filters.mine ? 'filled' : 'outlined'}
            onClick={() => onFiltersChange({ ...filters, mine: !filters.mine, owner: 'any' })}
            aria-pressed={filters.mine}
          />
          {showOwnerFilter && (
            <FormControl size="small" sx={{ minWidth: 180 }} disabled={filters.mine}>
              <InputLabel id="collection-owner-filter-label">Owner</InputLabel>
              <Select
                labelId="collection-owner-filter-label"
                label="Owner"
                value={selectedOwnerKnown ? ownerValue : 'any'}
                onChange={(e) => {
                  const choice = ownerChoices.find((c) => c.key === e.target.value)
                  onFiltersChange({ ...filters, owner: choice?.value ?? 'any' })
                }}
              >
                {ownerChoices.map((c) => (
                  <MenuItem key={c.key} value={c.key}>
                    {c.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>

        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : loading && collections.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
            <CircularProgress aria-label="Loading collections" />
          </Box>
        ) : collections.length === 0 ? (
          <Box
            data-testid="collections-empty"
            sx={{ textAlign: 'center', color: 'text.secondary', mt: 8 }}
          >
            <CollectionsIcon sx={{ fontSize: 56, opacity: 0.5 }} />
            <Typography variant="h6" sx={{ mt: 1 }}>
              No collections yet
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {filters.mine || filters.type !== 'all' || filters.owner !== 'any' ? (
                'No collections match the current filters.'
              ) : (
                <>
                  <Link
                    component="button"
                    variant="body2"
                    underline="hover"
                    onClick={openCreate}
                    sx={{ verticalAlign: 'baseline' }}
                  >
                    Create a collection
                  </Link>{' '}
                  to group images for side-by-side comparison or a guided sequence.
                </>
              )}
            </Typography>
          </Box>
        ) : (
          <Box
            data-testid="collections-grid"
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, 1fr)',
                md: 'repeat(3, 1fr)',
                lg: 'repeat(4, 1fr)',
              },
            }}
          >
            {collections.map((c) => (
              <CollectionCard
                key={c.id}
                collection={c}
                onOpen={(col) => onOpenCollection(col.id)}
                onEdit={(col) => void openEdit(col)}
                onDelete={requestDelete}
              />
            ))}
          </Box>
        )}
      </>
    )
  }

  return (
    <Box data-testid="collections-page">
      {editLoadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setEditLoadError(null)}>
          {editLoadError}
        </Alert>
      )}
      {body}

      <CollectionEditDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        collection={editing}
        programs={programs}
        groups={groups}
        onSave={handleSave}
      />

      <Dialog
        open={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false)
        }}
        TransitionProps={{ onExited: () => setDeleteTarget(null) }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Collection</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {deleteError && (
            <Alert severity="error" onClose={() => setDeleteError(null)}>
              {deleteError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? The images it
            references are not deleted.
          </Typography>
          {deleteTarget && (
            <Typography variant="caption" color="text.secondary">
              {COLLECTION_TYPE_LABELS[deleteTarget.type]} ·{' '}
              {COLLECTION_VISIBILITY_LABELS[deleteTarget.visibility]}
            </Typography>
          )}
          <Divider />
          <Box>
            <Button
              color="error"
              variant="contained"
              onClick={() => void confirmDelete()}
              disabled={deleting}
              startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : undefined}
              fullWidth
            >
              Delete
            </Button>
            <Typography
              variant="caption"
              color="error"
              sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
            >
              This action cannot be undone.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
