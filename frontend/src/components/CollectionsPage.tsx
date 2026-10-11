import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CollectionsIcon from '@mui/icons-material/Collections'
import EditIcon from '@mui/icons-material/Edit'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import ViewModuleIcon from '@mui/icons-material/ViewModule'
import HomeIcon from '@mui/icons-material/Home'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { fetchCollections, userMessage, type ApiImage } from '../api'
import {
  apiCollectionSummaryToSummary,
  COLLECTION_TYPE_LABELS,
  COLLECTIONS_AT_CAP_TOOLTIP,
  describeCollectionOwner,
  describeCollectionOwners,
  studentTypesAtCap,
} from '../collectionUtils'
import { getVisibilityColors } from '../theme'
import { useColorMode } from '../useColorMode'
import type { CollectionPageType } from './AppShell'
import { buildCategoryPaths } from './CategoryBreadcrumb'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { getCategoryHiddenStateFromPath } from '../treeUtils'
import { getInheritedRestrictionSx } from '../restrictionStyles'
import {
  toCollectionPatch,
  type CollectionListFilters,
  type CollectionOwnerFilter,
} from '../useCollectionsData'
import type {
  Category,
  Collection,
  CollectionOwner,
  CollectionSummary,
  CollectionType,
  Group,
  ImageItem,
  Program,
  User,
} from '../types'
import CollectionCard, { CollectionTypeChip, CollectionVisibilityChip } from './CollectionCard'
import CollectionEditDialog, { type CollectionFormValues } from './CollectionEditDialog'
import CollectionManageDialog, { type StageAddImages } from './CollectionManageDialog'
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
  /**
   * Whole-replace member order — the Manage dialog's Done commits its staged
   * draft (reorder + removals + additions) through this one PUT (#1567).
   */
  onReorderImages: (id: number, imageIds: number[]) => Promise<unknown>
  onCollectionImageRenewed: (collectionId: number, image: ApiImage) => void
  onViewerError: (message: string) => void
  /** Synchronized viewer mutation — whole-replace `viewport_state` (#1417). */
  onSaveViewport: (id: number, viewportState: Record<string, unknown>) => Promise<unknown>
  /** Mutations — reject with an ApiError to surface the message in the dialog. */
  loadCollection: (id: number) => Promise<Collection>
  onCreate: (values: CollectionFormValues) => Promise<Collection>
  onUpdate: (
    id: number,
    values: CollectionFormValues,
    version: number,
    baseline: Collection | null,
  ) => Promise<Collection>
  onDelete: (id: number) => Promise<void>
  /** Replace the user-owner set (`PUT …/owners`, #1531) — `canTransfer`-gated. */
  onSaveOwners: (id: number, userIds: number[]) => Promise<unknown>
  /** Program-owner reassignment (`POST …/transfer`, #1531) — `canTransfer`-gated. */
  onTransfer: (id: number, programId: number | null) => Promise<unknown>
  /**
   * Open the tile cover picker (CategoryTile's "Set card image"
   * convention). The summary carries no member list, so the caller loads
   * the collection detail before rendering the modal; the card's
   * `canEdit` gate decides visibility.
   */
  onPickCoverImage?: (collection: CollectionSummary) => void
  /**
   * File into a Browse category (#1529). Role-gated here (any
   * admin/instructor — filing is curatorial, not ownership-bound); App owns
   * the dialog + snackbar.
   */
  onMoveCollection?: (collection: CollectionSummary) => void
  /**
   * Category filing saved straight from the Edit dialog's picker (#1566) —
   * routes through the shared move path (POST …/move + snackbar + undo).
   */
  onMoveCollectionToCategory?: (
    collection: CollectionSummary,
    categoryId: number | null,
  ) => Promise<unknown>
  /**
   * Manage dialog "+" affordance (#1566): opens the global search modal so
   * picked images land in this collection through the standard add flow.
   */
  /**
   * Opens global search targeted at the collection; `stageAdd` is the Manage
   * dialog's draft-staging channel — picks join the draft, and Done persists
   * them in one whole-replace PUT (#1567).
   */
  onRequestCollectionImageSearch?: (collection: Collection, stageAdd: StageAddImages) => void
  /** Browse category tree — resolves the detail breadcrumb's location (#1559). */
  categories: Category[]
  /** Edit dialog category picker's inline affordances (#1566). */
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
  onToggleCategoryVisibility?: (categoryId: number) => Promise<void>
  /**
   * Navigate to a Browse category path (`[]` = root). The detail header's
   * breadcrumb uses this: `Home : …ancestors : collection name` (#1559).
   */
  onNavigateCategory: (categoryPath: Category[]) => void
  /**
   * Curatorial hide/show (#1559): PATCHes `hidden` on the open collection.
   * Rejects with an ApiError; the page surfaces the message via
   * `onViewerError` and re-disables the link while in flight.
   */
  onToggleHidden: (collection: Collection) => Promise<unknown>
}

function ownerFilterKey(owner: CollectionOwnerFilter): string {
  if (owner === 'any' || owner === 'orphaned') return owner
  return owner.kind === 'user' ? `u${owner.userId}` : `p${owner.programId}`
}

/**
 * Shared header for the collection detail views, mirroring the Image View
 * page (#1559, #1564): one top row with the Browse-style category-location
 * breadcrumb — `Home : …ancestors : collection name (N images)` — plus the
 * restricted program/group chips on the left and the action buttons on the
 * right. Below it, the type/visibility/hidden pills sit left of the owner
 * line and description. There is no `<h1>` — the collection name is the
 * breadcrumb's trailing item, like the image name on the image view.
 */
function CollectionDetailHeader({
  collection,
  programs,
  groups,
  categoryPath,
  onNavigateCategory,
  onEdit,
  onTransfer,
  onManage,
  togglingHidden,
  onToggleHidden,
  canFile,
  categoryHidden,
}: {
  collection: Collection
  programs: Program[]
  groups: Group[]
  categoryPath: Category[]
  onNavigateCategory: (categoryPath: Category[]) => void
  /** Admin/instructor filing right (#1567) — opens the edit dialog for the
   *  category picker even on collections they can't edit. */
  canFile?: boolean
  onEdit?: () => void
  onTransfer?: () => void
  /** Opens the member Manage dialog (#1566) — replaces the Reorder toggle. */
  onManage?: () => void
  togglingHidden?: boolean
  onToggleHidden?: () => void
  /** The filed category (or an ancestor) is hidden — the collection is
   *  invisible to students regardless of its own `hidden` flag, so the
   *  header desaturates and the hide control locks like the image view
   *  (and `CollectionEditDialog`) "Hidden by Category" state. */
  categoryHidden?: boolean
}) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  const programOwner = collection.owners.find((o) => o.kind === 'program')
  // 'Managed by …' for program- and user-managed collections alike (#1567);
  // an ownerless collection keeps the bare 'No owner' readout.
  const ownerText = programOwner
    ? `Managed by program ${programOwner.name}`
    : collection.owners.length > 0
      ? `Managed by ${describeCollectionOwners(collection.owners)}`
      : 'No owner'
  // Hidden collections desaturate their controls like the hidden-image view's
  // `inactiveViewerActionSx` (#1566) — chips, Manage/Edit/Owners, and the
  // Hide link; the viewer imagery stays in color (same as the image page).
  // A collection under a hidden category gets the same treatment.
  const hiddenSx = collection.hidden || categoryHidden ? { filter: 'grayscale(100%)' } : undefined
  // Restriction chips follow the image view / category tile convention
  // (#1567): the collection's own scope renders solid and the filed
  // category's effective scope renders at the inherited opacity.
  const ownProgramIds = collection.visibility === 'restricted' ? collection.programIds : []
  const ownGroupIds = collection.visibility === 'restricted' ? collection.groupIds : []
  const ownProgramSet = new Set(ownProgramIds)
  const ownGroupSet = new Set(ownGroupIds)
  const programChips = [
    ...ownProgramIds.map((id) => ({ id, inherited: false })),
    ...narrowProgramIds(categoryPath)
      .filter((id) => !ownProgramSet.has(id))
      .map((id) => ({ id, inherited: true })),
  ]
  const groupChips = [
    ...ownGroupIds.map((id) => ({ id, inherited: false })),
    ...narrowGroupIds(categoryPath)
      .filter((id) => !ownGroupSet.has(id))
      .map((id) => ({ id, inherited: true })),
  ]
  return (
    <>
      {/* Top container mirrors the image view header (#1564): breadcrumb +
          image count + restriction chips on the left, actions on the right.
          Segments navigate to the Browse scope; the trailing item carries
          the collection name plus a muted image count like the category
          page's `(N images)`. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          mb: 1,
          gap: 1,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            flex: '1 1 240px',
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          {/* `flex: 1` lets the breadcrumb consume the slack so the
              restriction chips land flush-left of the action buttons —
              the exact mechanism the image/category headers use (#1567). */}
          <Breadcrumbs
            aria-label="collection breadcrumb"
            data-testid="collection-breadcrumb"
            sx={{ flex: '1 1 auto', minWidth: 0 }}
          >
            <Link
              component="button"
              variant="body2"
              underline="hover"
              color="inherit"
              onClick={() => onNavigateCategory([])}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}
            >
              <HomeIcon fontSize="small" />
              Home
            </Link>
            {categoryPath.map((cat, i) => (
              <Link
                key={cat.id}
                component="button"
                variant="body2"
                underline="hover"
                color="inherit"
                onClick={() => onNavigateCategory(categoryPath.slice(0, i + 1))}
                sx={{ cursor: 'pointer' }}
              >
                {cat.label}
              </Link>
            ))}
            <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <Typography variant="body2" color="text.primary">
                {collection.name}
              </Typography>
              <Typography
                component="span"
                variant="body2"
                color="text.secondary"
                sx={{ ml: 0.5, fontSize: '0.9em' }}
              >
                ({collection.images.length} {collection.images.length === 1 ? 'image' : 'images'})
              </Typography>
              {/* Edit pencil on the final crumb — the Edit Category
                  breadcrumb-pencil pattern (#1567). Opens for owners
                  (canEdit) and curatorial filers (canFile). */}
              {(collection.permissions.canEdit || canFile) && onEdit && (
                <IconButton
                  size="small"
                  onClick={onEdit}
                  aria-label="Edit collection"
                  sx={{ ml: 0.25, ...hiddenSx }}
                >
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Box>
          </Breadcrumbs>
          {/* Restriction chips sit right after the breadcrumb — the same
              slot the image view renders them in: the collection's own
              scope solid, the filed category's scope at inherited opacity
              (#1567). */}
          {programChips.map((item) => (
            <Chip
              key={`p${item.id}`}
              size="small"
              color="primary"
              data-testid="detail-program-chip"
              label={programs.find((p) => p.id === item.id)?.name ?? `Program ${item.id}`}
              sx={getInheritedRestrictionSx(item.inherited, hiddenSx)}
            />
          ))}
          {groupChips.map((item) => (
            <Chip
              key={`g${item.id}`}
              size="small"
              color="secondary"
              data-testid="detail-group-chip"
              label={groups.find((g) => g.id === item.id)?.name ?? `Group ${item.id}`}
              sx={getInheritedRestrictionSx(item.inherited, hiddenSx)}
            />
          ))}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {/* Hide/show leads the actions — the same spot the image viewer's
              "Hide/Show Image" text-button occupies (#1559). A hidden filing
              category wins over the collection's own flag: the control locks
              to the disabled "Hidden by Category" state the image view and
              CollectionEditDialog use. */}
          {collection.permissions.canHide &&
            onToggleHidden &&
            (categoryHidden ? (
              <Button
                variant="text"
                size="small"
                startIcon={<VisibilityOffIcon />}
                disabled
                aria-label="Visibility: Hidden by category"
                data-testid="collection-hide-toggle"
                sx={{
                  '&.Mui-disabled': { color: visColors.inactive },
                  filter: 'grayscale(100%)',
                }}
              >
                Hidden by Category
              </Button>
            ) : (
              <Button
                variant="text"
                size="small"
                startIcon={collection.hidden ? <VisibilityOffIcon /> : <VisibilityIcon />}
                disabled={togglingHidden}
                onClick={onToggleHidden}
                data-testid="collection-hide-toggle"
                sx={
                  collection.hidden
                    ? { color: visColors.inactive, filter: 'grayscale(100%)' }
                    : undefined
                }
              >
                {collection.hidden ? 'Show collection' : 'Hide collection'}
              </Button>
            ))}
          {/* Manage opens the member dialog (reorder/add/remove, #1566) — it
              replaces the old sequence-only Reorder toggle and applies to
              both collection types. */}
          {onManage && collection.permissions.canEdit && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<ViewModuleIcon />}
              onClick={onManage}
              data-testid="collection-manage-open"
              sx={hiddenSx}
            >
              Manage Images
            </Button>
          )}
        </Box>
      </Box>

      {/* Second row (#1564): type + visibility pills to the left of the
          owner line, all vertically centered (#1567). Hidden state shows
          through the greyscale alone — no chip (#1567). */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          mb: 1,
        }}
      >
        {/* The shared type pill — red outline/text on white with the type
            icon, matching the tile and table (#1567). */}
        <CollectionTypeChip type={collection.type} sx={hiddenSx} />
        <Box sx={hiddenSx}>
          <CollectionVisibilityChip
            visibility={collection.visibility}
            hasScopeChips={programChips.length > 0 || groupChips.length > 0}
          />
        </Box>
        <Box sx={{ flex: '1 1 240px', minWidth: 0, display: 'flex', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {ownerText}
          </Typography>
          {/* Owners management lives on the owner line — the
              transfer-horizontal glyph beside the name opens the owners
              dialog (#1567). */}
          {collection.permissions.canTransfer && onTransfer && (
            <Tooltip title="Manage owners">
              <IconButton
                size="small"
                onClick={onTransfer}
                aria-label="Manage owners"
                data-testid="collection-owners-edit"
                sx={{ ml: 0.25, p: 0.25, ...hiddenSx }}
              >
                <SwapHorizIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
      {collection.memberCount > 0 && collection.images.length === 0 && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1, fontStyle: 'italic' }}
          data-testid="collection-all-restricted"
        >
          All images in this collection are currently restricted.
        </Typography>
      )}
      {/* Description sits under the type chip, left-aligned (#1567). */}
      {collection.description && (
        <Typography variant="body1" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
          {collection.description}
        </Typography>
      )}
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
  onPickCoverImage,
  onMoveCollection,
  onMoveCollectionToCategory,
  onRequestCollectionImageSearch,
  categories,
  onAddCategory,
  onEditCategory,
  onToggleCategoryVisibility,
  onNavigateCategory,
  onToggleHidden,
  collectionPageType,
}: CollectionsPageProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState<CollectionSummary | null>(null)
  const [togglingHidden, setTogglingHidden] = useState(false)
  // Member-management dialog (#1566) — reorder/add/remove live here now that
  // the sequence viewer's inline reorder mode is gone.
  const [manageOpen, setManageOpen] = useState(false)
  const editRequestRef = useRef(0)

  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])
  const detailCategoryPath = useMemo(() => {
    if (detail?.categoryId == null) return []
    const seg = categoryPaths.get(detail.categoryId)
    return seg ? [...seg.ancestors, seg.category] : []
  }, [categoryPaths, detail])
  // Hidden-subtree rule: a collection filed under a hidden category is
  // invisible to students even when its own `hidden` flag is clear — the
  // header and the sequence filmstrip surface that inherited state.
  const detailCategoryHidden = useMemo(
    () => getCategoryHiddenStateFromPath(detailCategoryPath).hidden,
    [detailCategoryPath],
  )

  const handleToggleHidden = () => {
    if (!detail || togglingHidden) return
    setTogglingHidden(true)
    void onToggleHidden(detail)
      .catch((err: unknown) => onViewerError(userMessage(err, 'Failed to update the collection.')))
      .finally(() => setTogglingHidden(false))
  }

  const isAdmin = currentUser?.role === 'admin'
  const showOwnerFilter = currentUser != null && currentUser.role !== 'student'
  // Filing collections into categories is curatorial: any admin/instructor
  // may move any collection (unlike edit/delete, which are owner-scoped).
  const canFileCollections = currentUser?.role === 'admin' || currentUser?.role === 'instructor'
  const [typesAtLimit, setTypesAtLimit] = useState<ReadonlySet<CollectionType>>(() => new Set())

  useEffect(() => {
    if (currentUser?.role !== 'student') {
      setTypesAtLimit(new Set())
      return
    }

    let cancelled = false
    void fetchCollections({ mine: true })
      .then((rows) => {
        if (!cancelled) {
          setTypesAtLimit(studentTypesAtCap(rows.map(apiCollectionSummaryToSummary), currentUser))
        }
      })
      .catch(() => {
        if (!cancelled) setTypesAtLimit(new Set())
      })

    return () => {
      cancelled = true
    }
  }, [collections, currentUser])

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
      // PATCH only real field diffs (#1567 review): a version-only body is a
      // content write the backend 403s for filing-only curators (and a no-op
      // bump for everyone else). A hidden-only diff still PATCHes — hide is
      // curatorial, not owner-scoped.
      const updated = Object.keys(toCollectionPatch(values, baseline, version)).some(
        (k) => k !== 'version',
      )
        ? await onUpdate(editing.id, values, version, baseline)
        : editing
      // Advance the record the dialog is seeded from (#1567): if the chained
      // move below fails, the editor stays open with baseline/version already
      // at the saved state — a retry diffs clean instead of replaying a
      // stale-version PATCH.
      setEditing(updated)
      // Category filing is a move, not a PATCH (#1566) — apply it after the
      // metadata save so the move posts the just-refreshed version. A failed
      // move must not read as a successful save: the move op already showed
      // its error snackbar, so rethrow the API error — the dialog stays open
      // with the real message (and its 409 conflict-reload path) (#1567).
      if (values.categoryId !== (baseline?.categoryId ?? null)) {
        const moved = await onMoveCollectionToCategory?.(updated, values.categoryId)
        if (moved instanceof Error) throw moved
        // Filing bypasses `update`, which is what normally refreshes the open
        // detail — refetch so the breadcrumb and the next filing's version
        // don't work from the pre-move record (#1567). Best-effort: the save
        // already succeeded, so a refresh failure must not read as one.
        void loadCollection(editing.id).catch(() => {})
      }
    } else {
      const created = await onCreate(values)
      onOpenCollection(created.id)
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
  const viewerFlexSx = {
    display: { md: 'flex' },
    flexDirection: { md: 'column' },
    flex: { md: '1 1 0' },
  } as const
  const hasLoadedViewerDetail =
    selectedCollectionId != null && detail != null && detailError == null

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
                Back
              </Button>
            }
          >
            {detailError}
          </Alert>
        </Box>
      )
    } else if (detail && detail.type === 'sequence') {
      body = (
        <Box data-testid="collection-detail" sx={viewerFlexSx}>
          <Box sx={{ flexShrink: 0 }}>
            <CollectionDetailHeader
              collection={detail}
              programs={programs}
              groups={groups}
              categoryPath={detailCategoryPath}
              onNavigateCategory={onNavigateCategory}
              canFile={canFileCollections}
              onEdit={() => void openEdit(detail)}
              onTransfer={() => setTransferTarget(detail)}
              onManage={() => setManageOpen(true)}
              togglingHidden={togglingHidden}
              onToggleHidden={handleToggleHidden}
              categoryHidden={detailCategoryHidden}
            />
          </Box>
          <SequenceCollectionViewer
            collection={detail}
            itemId={selectedCollectionItemId}
            onSelectItem={onSelectCollectionItem}
            onOpenImage={onOpenImage}
            onImageRenewed={(image) => onCollectionImageRenewed(detail.id, image)}
            onError={onViewerError}
            hidden={detail.hidden || detailCategoryHidden}
          />
        </Box>
      )
    } else if (detail && detail.type === 'synchronized') {
      body = (
        <Box data-testid="collection-detail" sx={viewerFlexSx}>
          <Box sx={{ flexShrink: 0 }}>
            <CollectionDetailHeader
              collection={detail}
              programs={programs}
              groups={groups}
              categoryPath={detailCategoryPath}
              onNavigateCategory={onNavigateCategory}
              canFile={canFileCollections}
              onEdit={() => void openEdit(detail)}
              onTransfer={() => setTransferTarget(detail)}
              onManage={() => setManageOpen(true)}
              togglingHidden={togglingHidden}
              onToggleHidden={handleToggleHidden}
              categoryHidden={detailCategoryHidden}
            />
          </Box>
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
            <Tooltip title={typesAtLimit.size === 2 ? COLLECTIONS_AT_CAP_TOOLTIP : ''}>
              <span>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={openCreate}
                  disabled={typesAtLimit.size === 2}
                >
                  New collection
                </Button>
              </span>
            </Tooltip>
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
            {collections.map((c) => {
              const seg = c.categoryId != null ? categoryPaths.get(c.categoryId) : undefined
              const catPath = seg ? [...seg.ancestors, seg.category] : []
              return (
                <Box key={c.id} sx={{ width: 300, maxWidth: '100%' }}>
                  <CollectionCard
                    collection={c}
                    onOpen={(col) => onOpenCollection(col.id)}
                    onEdit={(col) => void openEdit(col)}
                    onPickCoverImage={onPickCoverImage}
                    onMove={canFileCollections ? onMoveCollection : undefined}
                    programs={programs}
                    inheritedProgramIds={narrowProgramIds(catPath)}
                    groups={groups}
                    inheritedGroupIds={narrowGroupIds(catPath)}
                    categoryHidden={getCategoryHiddenStateFromPath(catPath).hidden}
                  />
                </Box>
              )
            })}
          </Box>
        )}
      </>
    )
  }

  return (
    <Box data-testid="collections-page" sx={hasLoadedViewerDetail ? viewerFlexSx : undefined}>
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
        defaultType={collectionPageType}
        typesAtLimit={typesAtLimit}
        programs={programs}
        groups={groups}
        onSave={handleSave}
        onDelete={editing?.permissions.canDelete ? deleteFromDialog : undefined}
        categories={categories}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleCategoryVisibility}
        onViewCollection={
          editing && editing.id !== selectedCollectionId
            ? () => {
                setEditorOpen(false)
                onOpenCollection(editing.id)
              }
            : undefined
        }
      />

      {/* The Manage dialog stages membership edits locally (#1567); Done
          commits them through one whole-replace PUT — only then does the
          detail behind it change. */}
      <CollectionManageDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        collection={detail}
        onSaveMembers={(imageIds) =>
          detail ? onReorderImages(detail.id, imageIds) : Promise.resolve()
        }
        onAddImages={
          detail && onRequestCollectionImageSearch
            ? (stageAdd) => onRequestCollectionImageSearch(detail, stageAdd)
            : undefined
        }
        onImageRenewed={(image) => detail && onCollectionImageRenewed(detail.id, image)}
        onError={onViewerError}
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
