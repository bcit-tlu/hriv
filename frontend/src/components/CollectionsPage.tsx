import { useRef, useState, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CollectionsIcon from '@mui/icons-material/Collections'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import EditIcon from '@mui/icons-material/Edit'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { userMessage, type ApiImage } from '../api'
import {
  COLLECTION_TYPE_LABELS,
  describeCollectionOwner,
  describeCollectionOwners,
} from '../collectionUtils'
import { getGroupChipColors } from '../theme'
import { useColorMode } from '../useColorMode'
import type { CollectionPageType } from './AppShell'
import type { CollectionListFilters, CollectionOwnerFilter } from '../useCollectionsData'
import type {
  Collection,
  CollectionOwner,
  CollectionSummary,
  Group,
  ImageItem,
  Program,
  User,
} from '../types'
import CollectionCard, { CollectionVisibilityChip } from './CollectionCard'
import CollectionEditDialog, { type CollectionFormValues } from './CollectionEditDialog'
import CollectionOwnersDialog from './CollectionOwnersDialog'
import SequenceCollectionViewer from './SequenceCollectionViewer'
import SynchronizedCollectionViewer from './SynchronizedCollectionViewer'

export interface CollectionsPageProps {
  /** Which type page is rendered — headings, empty state, type chip context. */
  collectionPageType: CollectionPageType
  currentUser: User | null
  programs: Program[]
  groups: Group[]
  /** List state (owned by `useCollectionsData`). */
  collections: CollectionSummary[]
  loading: boolean
  error: string | null
  filters: CollectionListFilters
  onFiltersChange: (filters: CollectionListFilters) => void
  ownerOptions: CollectionOwner[]
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
  /** Synchronized viewer mutation — whole-replace `viewport_state` (#1417). */
  onSaveViewport: (id: number, viewportState: Record<string, unknown>) => Promise<unknown>
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
  /** Replace the user-owner set (`PUT …/owners`, #1531) — `canTransfer`-gated. */
  onSaveOwners: (id: number, userIds: number[]) => Promise<unknown>
  /** Program-owner reassignment (`POST …/transfer`, #1531) — `canTransfer`-gated. */
  onTransfer: (id: number, programId: number | null) => Promise<unknown>
  /**
   * File into a Browse category (#1529). Role-gated here (any
   * admin/instructor — filing is curatorial, not ownership-bound); App owns
   * the dialog + snackbar.
   */
  onMoveCollection?: (collection: CollectionSummary) => void
  /**
   * Label for the detail view's back button (#1529): `?cat=` context means
   * "Back to Browse", otherwise "All collections".
   */
  detailBackLabel?: string
}

function ownerFilterKey(owner: CollectionOwnerFilter): string {
  if (owner === 'any' || owner === 'orphaned') return owner
  return owner.kind === 'user' ? `u${owner.userId}` : `p${owner.programId}`
}

/** Shared header for the collection detail views (placeholder + viewers). */
function CollectionDetailHeader({
  collection,
  programs,
  groups,
  onBack,
  backLabel = 'All collections',
  onEdit,
  onTransfer,
  onMove,
}: {
  collection: Collection
  programs: Program[]
  groups: Group[]
  onBack: () => void
  backLabel?: string
  onEdit?: () => void
  onTransfer?: () => void
  onMove?: () => void
}) {
  const { mode } = useColorMode()
  const groupColors = getGroupChipColors(mode)
  const programOwner = collection.owners.find((o) => o.kind === 'program')
  const ownerText = programOwner
    ? `Managed by program ${programOwner.name}`
    : describeCollectionOwners(collection.owners)
  return (
    <>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 1 }}>
        {backLabel}
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
            {ownerText} · {collection.images.length}{' '}
            {collection.images.length === 1 ? 'image' : 'images'}
          </Typography>
          {collection.memberCount > 0 && collection.images.length === 0 && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, fontStyle: 'italic' }}
              data-testid="collection-all-restricted"
            >
              All images in this collection are currently restricted.
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            <Chip
              size="small"
              variant="outlined"
              color="primary"
              label={COLLECTION_TYPE_LABELS[collection.type]}
            />
            <CollectionVisibilityChip visibility={collection.visibility} />
            {collection.visibility === 'restricted' && (
              <>
                {collection.programIds.map((pid) => (
                  <Chip
                    key={`p${pid}`}
                    size="small"
                    variant="outlined"
                    color="primary"
                    data-testid="detail-program-chip"
                    label={programs.find((p) => p.id === pid)?.name ?? `Program ${pid}`}
                  />
                ))}
                {collection.groupIds.map((gid) => (
                  <Chip
                    key={`g${gid}`}
                    size="small"
                    data-testid="detail-group-chip"
                    label={groups.find((g) => g.id === gid)?.name ?? `Group ${gid}`}
                    sx={{ bgcolor: groupColors.subtleBg, color: groupColors.subtleText }}
                  />
                ))}
              </>
            )}
          </Box>
          {collection.description && (
            <Typography variant="body1" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
              {collection.description}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {onMove && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<DriveFileMoveIcon />}
              onClick={onMove}
            >
              Move
            </Button>
          )}
          {collection.permissions.canEdit && onEdit && (
            <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={onEdit}>
              Edit
            </Button>
          )}
          {collection.permissions.canTransfer && onTransfer && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<SwapHorizIcon />}
              onClick={onTransfer}
            >
              Owners
            </Button>
          )}
        </Box>
      </Box>
    </>
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
  onSaveViewport,
  loadCollection,
  onCreate,
  onUpdate,
  onDelete,
  onSaveOwners,
  onTransfer,
  onMoveCollection,
  detailBackLabel,
  collectionPageType,
}: CollectionsPageProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState<CollectionSummary | null>(null)
  const editRequestRef = useRef(0)

  const isAdmin = currentUser?.role === 'admin'
  const showOwnerFilter = currentUser != null && currentUser.role !== 'student'
  // Filing collections into categories is curatorial: any admin/instructor
  // may move any collection (unlike edit/delete, which are owner-scoped).
  const canFileCollections = currentUser?.role === 'admin' || currentUser?.role === 'instructor'

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

  // Delete lives inside the edit dialog only (#1554) — mirrors
  // EditImageModal's delete-in-dialog convention.
  const deleteFromDialog = async () => {
    if (!editing) return
    await onDelete(editing.id)
    setEditorOpen(false)
    if (selectedCollectionId === editing.id) onCloseCollection()
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
            programs={programs}
            groups={groups}
            onBack={onCloseCollection}
            backLabel={detailBackLabel}
            onEdit={() => void openEdit(detail)}
            onTransfer={() => setTransferTarget(detail)}
            onMove={
              canFileCollections && onMoveCollection ? () => onMoveCollection(detail) : undefined
            }
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
    } else if (detail && detail.type === 'synchronized') {
      body = (
        <Box data-testid="collection-detail">
          <CollectionDetailHeader
            collection={detail}
            programs={programs}
            groups={groups}
            onBack={onCloseCollection}
            backLabel={detailBackLabel}
            onEdit={() => void openEdit(detail)}
            onTransfer={() => setTransferTarget(detail)}
            onMove={
              canFileCollections && onMoveCollection ? () => onMoveCollection(detail) : undefined
            }
          />
          <SynchronizedCollectionViewer
            collection={detail}
            onSaveViewport={(viewportState) => onSaveViewport(detail.id, viewportState)}
            onOpenImage={onOpenImage}
            onImageRenewed={(image) => onCollectionImageRenewed(detail.id, image)}
            onError={onViewerError}
          />
        </Box>
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
            mb: 3,
          }}
        >
          <Typography variant="h5" component="h1">
            {COLLECTION_TYPE_LABELS[collectionPageType]} collections
          </Typography>
          {/* Type is the page, not a filter (#1554): the remaining filters
              live in the header row, left of New collection. */}
          <Box
            data-testid="collection-filters"
            sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}
          >
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
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              New collection
            </Button>
          </Box>
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
              {filters.mine || filters.owner !== 'any' ? (
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
          <Box data-testid="collections-grid" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {collections.map((c) => (
              <Box key={c.id} sx={{ width: 300, maxWidth: '100%' }}>
                <CollectionCard
                  collection={c}
                  onOpen={(col) => onOpenCollection(col.id)}
                  onEdit={(col) => void openEdit(col)}
                  onTransfer={setTransferTarget}
                  onMove={canFileCollections ? onMoveCollection : undefined}
                />
              </Box>
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
        onDelete={editing?.permissions.canDelete ? deleteFromDialog : undefined}
      />

      <CollectionOwnersDialog
        open={transferTarget != null}
        onClose={() => setTransferTarget(null)}
        collection={transferTarget}
        programs={programs}
        onSaveOwners={onSaveOwners}
        onTransfer={onTransfer}
      />
    </Box>
  )
}
