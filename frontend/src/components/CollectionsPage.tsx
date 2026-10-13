import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CollectionsIcon from '@mui/icons-material/Collections'
import EditIcon from '@mui/icons-material/Edit'
import HubIcon from '@mui/icons-material/Hub'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import TableRowsIcon from '@mui/icons-material/TableRows'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import ViewModuleIcon from '@mui/icons-material/ViewModule'
import HomeIcon from '@mui/icons-material/Home'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import {
  fetchCollection,
  fetchCollections,
  fetchCollectionsGraph,
  userMessage,
  type ApiCollectionsGraph,
  type ApiImage,
} from '../api'
import {
  apiCollectionSummaryToSummary,
  COLLECTION_TYPE_LABELS,
  COLLECTION_VISIBILITY_LABELS,
  COLLECTIONS_AT_CAP_TOOLTIP,
  describeCollectionOwner,
  describeCollectionOwners,
  studentTypesAtCap,
} from '../collectionUtils'
import { getVisibilityColors } from '../theme'
import { useColorMode } from '../useColorMode'
import {
  useCollectionsViewPreference,
  type CollectionsGraphOrder,
  type CollectionsView,
} from '../useCollectionsViewPreference'
import CollectionsGraph from '../collectionsGraph/CollectionsGraph'
import { buildGraphModel } from '../collectionsGraph/buildModel'
import type { GraphModel } from '../collectionsGraph/types'
import { graphToggleSx } from '../collectionsGraph/toggleStyles'
import CollectionsTable, {
  COLLECTIONS_TABLE_COLUMN_OPTIONS,
  COLLECTIONS_TABLE_COLUMNS,
  DEFAULT_VISIBLE_COLLECTIONS_TABLE_COLUMNS,
  DEFAULT_VISIBLE_CURATOR_COLLECTIONS_TABLE_COLUMNS,
  type CollectionsTableColumn,
} from './CollectionsTable'
import BulkEditCollectionsDialog from './BulkEditCollectionsDialog'
import CategoryFilterTreePanel from './CategoryFilterTreePanel'
import ColumnVisibilityDialog, { type ColumnVisibilityOption } from './ColumnVisibilityDialog'
import FilterBar from './FilterBar'
import FilterOptionPanel from './FilterOptionPanel'
import FilterPopoverButton from './FilterPopoverButton'
import FilterTextPanel from './FilterTextPanel'
import { buildCategoryPaths } from './CategoryBreadcrumb'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { getCategoryHiddenStateFromPath } from '../treeUtils'
import { getInheritedRestrictionSx } from '../restrictionStyles'
import {
  DEFAULT_COLLECTION_FILTERS,
  toCollectionPatch,
  type CollectionListFilters,
  type CollectionOwnerFilter,
} from '../useCollectionsData'
import { useTableColumnPreferences } from '../useTableColumnPreferences'
import type {
  Category,
  Collection,
  CollectionOwner,
  CollectionSummary,
  CollectionType,
  CollectionVisibility,
  Group,
  ImageItem,
  Program,
  User,
} from '../types'
import CollectionCard, { CollectionTypeChip, CollectionVisibilityChip } from './CollectionCard'
import CollectionEditDialog, { type CollectionFormValues } from './CollectionEditDialog'
import CollectionGraphDialog from './CollectionGraphDialog'
import CollectionManageDialog, { type StageAddImages } from './CollectionManageDialog'
import CollectionOwnersDialog from './CollectionOwnersDialog'
import SequenceCollectionViewer from './SequenceCollectionViewer'
import SynchronizedCollectionViewer from './SynchronizedCollectionViewer'

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
  ownerOptions: CollectionOwner[]
  /** Detail placeholder state; `selectedCollectionId` null renders the list. */
  selectedCollectionId: number | null
  detail: Collection | null
  detailLoading: boolean
  detailError: string | null
  onOpenCollection: (id: number) => void
  onCloseCollection: () => void
  onOpenImage: (image: ImageItem) => void
  /** Graph-view image clicks carry only an id (#1629) — the caller fetches
   *  the record and takes the normal `?image={id}` viewer path. */
  onOpenImageById?: (imageId: number) => void
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
  /** Reports the current Cards/Table/Graph view so the shell can fill the
   *  viewport in graph view (#1630 feedback). */
  onViewChange?: (view: CollectionsView) => void
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
  onToggleHidden: (collection: CollectionSummary) => Promise<unknown>
  /**
   * Table-view bulk edit (#1578): refile and/or hide the selected rows in
   * one atomic call. Rejects with an ApiError; the dialog shows it.
   */
  onBulkUpdate?: (
    ids: number[],
    data: { category_id?: number | null; hidden?: boolean },
  ) => Promise<void>
  /** Table-view bulk delete (#1578) — every row must be `canDelete`. */
  onBulkDelete?: (ids: number[]) => Promise<void>
  /** View to open on mount instead of Cards (old `?page=manage-collections` links). */
  initialView?: CollectionsView
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
  onOpenGraph,
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
  /** Opens the Graph View dialog (#1630) — read-only, shown to everyone. */
  onOpenGraph?: () => void
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
          {/* Graph View sits between Hide and Manage (#1630): a read-only
              structural view every viewer gets, no permission gate. */}
          {onOpenGraph && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<HubIcon />}
              onClick={onOpenGraph}
              data-testid="collection-graph-open"
              sx={hiddenSx}
            >
              Graph View
            </Button>
          )}
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
  onViewChange,
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
  onOpenImageById,
  onBulkUpdate,
  onBulkDelete,
  initialView,
}: CollectionsPageProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [transferTarget, setTransferTarget] = useState<CollectionSummary | null>(null)
  const [togglingHidden, setTogglingHidden] = useState(false)
  // Member-management dialog (#1566) — reorder/add/remove live here now that
  // the sequence viewer's inline reorder mode is gone.
  const [manageOpen, setManageOpen] = useState(false)
  const [graphDialogOpen, setGraphDialogOpen] = useState(false)
  const editRequestRef = useRef(0)
  // Render-phase adjustment: close the graph dialog when the detail
  // collection changes or closes, so Back → Forward cannot resurrect it
  // without another click (#1638 review).
  const [graphDialogFor, setGraphDialogFor] = useState<number | null>(null)
  if (graphDialogFor !== (detail?.id ?? null)) {
    setGraphDialogFor(detail?.id ?? null)
    if (graphDialogOpen) setGraphDialogOpen(false)
  }

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

  // ── Unified page view state (#1629) ──────────────────────────────
  const [viewPrefs, setViewPrefs] = useCollectionsViewPreference(currentUser?.id ?? null, {
    initialView,
  })
  // The shell fills the viewport for the graph view, so it needs the
  // current view reported upward (the pref itself is per-user state).
  useEffect(() => {
    onViewChange?.(viewPrefs.view)
  }, [onViewChange, viewPrefs.view])
  // Search and the Visibility facet are client-side and intentionally NOT
  // persisted.
  const [searchQuery, setSearchQuery] = useState('')
  const [visibilityFilter, setVisibilityFilter] = useState<ReadonlySet<CollectionVisibility>>(
    () => new Set(),
  )
  // Category facet — client-side and ancestor-aware like the Images table:
  // a parent matches collections filed anywhere beneath it.
  const [categoryFilter, setCategoryFilter] = useState<ReadonlySet<number>>(() => new Set())
  // Table-view bulk selection (#1578), reconciled against the live rows so a
  // collection deleted elsewhere can't linger in a later bulk call.
  const [selectedIdsRaw, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set())
  const selectedIds = useMemo(() => {
    const live = new Set(collections.map((c) => c.id))
    return [...selectedIdsRaw].every((id) => live.has(id))
      ? selectedIdsRaw
      : new Set([...selectedIdsRaw].filter((id) => live.has(id)))
  }, [collections, selectedIdsRaw])
  // Commit the pruning so a row that leaves the list (server-side filter,
  // delete) does not come back selected when it reappears.
  if (selectedIds !== selectedIdsRaw) setSelectedIds(selectedIds)
  const selectedRows = useMemo(
    () => collections.filter((c) => selectedIds.has(c.id)),
    [collections, selectedIds],
  )
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [graphPayload, setGraphPayload] = useState<ApiCollectionsGraph | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)

  // The graph payload fetches lazily the first time Graph is selected,
  // then refetches only when the order or the listed collections change —
  // switching view alone never invalidates the model, so positions and
  // zoom survive Cards → Graph → Cards round-trips (#1636 review). Once a
  // payload exists it keeps refreshing while hidden so the kept-alive
  // canvas reflects filter edits made from cards/table.
  const graphLoaded = graphPayload != null
  const fetchedGraph = useRef<{ order: number; collections: typeof collections } | null>(null)
  useEffect(() => {
    if (selectedCollectionId != null) return
    if (viewPrefs.view !== 'graph' && !graphLoaded) return
    const f = fetchedGraph.current
    if (f != null && f.order === viewPrefs.order && f.collections === collections) return
    fetchedGraph.current = { order: viewPrefs.order, collections }
    let cancelled = false
    fetchCollectionsGraph(viewPrefs.order)
      .then((payload) => {
        if (!cancelled) {
          setGraphPayload(payload)
          setGraphError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          fetchedGraph.current = null
          setGraphError(userMessage(err, 'Failed to load the collections graph.'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [viewPrefs.view, viewPrefs.order, collections, graphLoaded, selectedCollectionId])

  const renewCoverThumb = useMemo(
    () => (id: number) => fetchCollection(id).then((c) => ({ id: c.id, thumb: c.cover_thumb })),
    [],
  )

  // List rows already carry the server-side filters (type / mine / owner) —
  // intersecting the payload with their ids is how those filters reach the
  // graph; search only highlights (#1629). The previous model seeds each
  // rebuild so settled positions survive refetches and Shared-only toggles
  // (#1636) — stored in render-phase-adjusted state (same sanctioned
  // "you might not need an effect" pattern as the type seed).
  const [graphState, setGraphState] = useState<{
    payload: ApiCollectionsGraph | null
    collections: typeof collections
    sharedOnly: boolean
    model: GraphModel | null
  }>({ payload: null, collections, sharedOnly: viewPrefs.sharedOnly, model: null })
  if (
    graphState.payload !== graphPayload ||
    graphState.collections !== collections ||
    graphState.sharedOnly !== viewPrefs.sharedOnly
  ) {
    setGraphState({
      payload: graphPayload,
      collections,
      sharedOnly: viewPrefs.sharedOnly,
      model: graphPayload
        ? buildGraphModel(
            graphPayload,
            new Set(collections.map((c) => c.id)),
            viewPrefs.sharedOnly,
            graphState.model ?? undefined,
          )
        : null,
    })
  }
  const graphModel = graphState.model

  const graphTooltipInfo = useMemo(() => {
    const byId = new Map(collections.map((c) => [c.id, c]))
    return {
      categoryLabel: (categoryId: number | null) => {
        if (categoryId == null) return ''
        const seg = categoryPaths.get(categoryId)
        return seg ? [...seg.ancestors, seg.category].map((c) => c.label).join(' › ') : ''
      },
      ownerLabel: (id: number) => {
        const c = byId.get(id)
        return c ? describeCollectionOwners(c.owners) : undefined
      },
      collectionName: (id: number) =>
        byId.get(id)?.name ?? graphPayload?.collections.find((c) => c.id === id)?.name,
    }
  }, [collections, categoryPaths, graphPayload])
  // Filing collections into categories is curatorial: any admin/instructor
  // may move any collection (unlike edit/delete, which are owner-scoped).
  const canFileCollections = currentUser?.role === 'admin' || currentUser?.role === 'instructor'
  const [typesAtLimit, setTypesAtLimit] = useState<ReadonlySet<CollectionType>>(() => new Set())

  useEffect(() => {
    if (currentUser?.role !== 'student') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stale cap for non-students
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

  // Owner facet options for the FilterBar popover: "My collections" first
  // (every role), then the known owners for non-students and the
  // admin-only orphaned state — the same choices the old Select/chips row
  // exposed (#1629 follow-up).
  const ownerFacetOptions: {
    value: string
    label: string
    filter: CollectionOwnerFilter | 'mine'
  }[] = [
    { value: 'mine', label: 'My collections', filter: 'mine' },
    ...(showOwnerFilter
      ? ownerOptions.map((o) => ({
          value: ownerFilterKey(o),
          label: describeCollectionOwner(o),
          filter: o as CollectionOwnerFilter,
        }))
      : []),
    ...(isAdmin
      ? [{ value: 'orphaned', label: 'No owner (orphaned)', filter: 'orphaned' as const }]
      : []),
  ]
  const ownerSelected = filters.mine
    ? ['mine']
    : filters.owner === 'any'
      ? []
      : [ownerFilterKey(filters.owner)]

  // Choose Columns (table view) — per-user persisted visibility + order,
  // the same hook/storage convention as the Manage tables (#1577).
  // Curators get the Visibility (hide) switch by default; students never
  // see hidden collections, so the column is not offered to them at all.
  const isStudent = currentUser?.role === 'student'
  const {
    visibleColumns,
    toggleColumn,
    columnOrder,
    orderedVisibleColumns: storedVisibleColumns,
    setColumnOrder,
  } = useTableColumnPreferences<CollectionsTableColumn>({
    tableKey: 'collections',
    allColumns: COLLECTIONS_TABLE_COLUMNS,
    defaultVisibleColumns: canFileCollections
      ? DEFAULT_VISIBLE_CURATOR_COLLECTIONS_TABLE_COLUMNS
      : DEFAULT_VISIBLE_COLLECTIONS_TABLE_COLUMNS,
  })
  const orderedVisibleColumns = isStudent
    ? storedVisibleColumns.filter((c) => c !== 'visibility')
    : storedVisibleColumns
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const orderedColumnOptions = useMemo(() => {
    const byKey = new Map(COLLECTIONS_TABLE_COLUMN_OPTIONS.map((o) => [o.key, o]))
    return columnOrder
      .filter((key) => !isStudent || key !== 'visibility')
      .map((key) => byKey.get(key))
      .filter((o): o is ColumnVisibilityOption<CollectionsTableColumn> => o != null)
  }, [columnOrder, isStudent])
  const viewerFlexSx = {
    display: { md: 'flex' },
    flexDirection: { md: 'column' },
    flex: { md: '1 1 0' },
    minHeight: { md: 0 },
  } as const
  const hasLoadedViewerDetail =
    selectedCollectionId != null && detail != null && detailError == null
  // The list graph fills the page like the detail viewers (#1630 feedback).
  const graphViewActive = selectedCollectionId == null && viewPrefs.view === 'graph'

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
              onOpenGraph={() => setGraphDialogOpen(true)}
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
              onOpenGraph={() => setGraphDialogOpen(true)}
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
    // The Name text and Visibility facet are client-side and never
    // persisted (#1629): they narrow the cards/table rows, and in the
    // graph only highlight matches — nodes are never removed.
    const searchQ = searchQuery.trim().toLowerCase()
    const matchesClientFilters = (c: CollectionSummary): boolean => {
      if (visibilityFilter.size > 0 && !visibilityFilter.has(c.visibility)) return false
      if (categoryFilter.size > 0) {
        const seg = c.categoryId != null ? categoryPaths.get(c.categoryId) : undefined
        if (!seg) return false
        if (![seg.category, ...seg.ancestors].some((cat) => categoryFilter.has(cat.id))) {
          return false
        }
      }
      return (
        searchQ === '' ||
        `${c.name} ${c.description ?? ''} ${describeCollectionOwners(c.owners)}`
          .toLowerCase()
          .includes(searchQ)
      )
    }
    const shownCollections =
      searchQ || visibilityFilter.size > 0 || categoryFilter.size > 0
        ? collections.filter(matchesClientFilters)
        : collections
    const searchHelper =
      viewPrefs.view === 'graph'
        ? 'Highlights matches in the graph; nodes are not removed.'
        : 'Filters by name, description and owner.'
    const hasActiveFilters =
      filters.type !== 'all' ||
      filters.mine ||
      filters.owner !== 'any' ||
      searchQ !== '' ||
      visibilityFilter.size > 0 ||
      categoryFilter.size > 0
    const clearAllFilters = () => {
      onFiltersChange({ ...DEFAULT_COLLECTION_FILTERS })
      setSearchQuery('')
      setVisibilityFilter(new Set())
      setCategoryFilter(new Set())
    }
    const ownerSummaryLabel = filters.mine
      ? 'My collections'
      : filters.owner === 'orphaned'
        ? 'No owner'
        : filters.owner === 'any'
          ? ''
          : describeCollectionOwner(filters.owner)

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
            flexShrink: 0,
          }}
        >
          <Typography variant="h5" component="h1">
            Collections
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
            {/* View toggle — Cards / Table / Graph (#1629); available to
                every role. The view is intentionally not persisted — the
                page always loads on Cards while Table/Graph are being
                evaluated (#1629 follow-up). */}
            <ToggleButtonGroup
              size="small"
              exclusive
              value={viewPrefs.view}
              onChange={(_, v: CollectionsView | null) => {
                if (v) setViewPrefs((p) => ({ ...p, view: v }))
              }}
              aria-label="Collections view"
              data-testid="collections-view-toggle"
              sx={graphToggleSx}
            >
              <ToggleButton value="cards" aria-label="Cards view">
                <Tooltip title="Cards: one tile per collection with its cover image">
                  <ViewModuleIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="table" aria-label="Table view">
                <Tooltip title="Table: sortable rows with choosable columns">
                  <TableRowsIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="graph" aria-label="Graph view">
                <Tooltip title="Graph: how collections, images and categories connect">
                  <HubIcon fontSize="small" />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
            {viewPrefs.view === 'table' && selectedIds.size > 0 && (
              <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={() => setBulkEditOpen(true)}
              >
                Bulk Edit ({selectedIds.size} selected)
              </Button>
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

        {/* Shared filter bar (#1629): the popover facets feed all three
            views — type/mine/owner stay server-side filters; Name and
            Visibility narrow client-side. */}
        <FilterBar
          clearAction={
            hasActiveFilters ? (
              <Button
                size="small"
                color="secondary"
                onClick={clearAllFilters}
                sx={{
                  minWidth: 0,
                  px: 0,
                  fontWeight: 600,
                  textTransform: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Clear all
              </Button>
            ) : undefined
          }
          summary={
            hasActiveFilters ? (
              <>
                {filters.type !== 'all' && (
                  <Chip
                    data-testid="filter-chip"
                    label={`Type: ${COLLECTION_TYPE_LABELS[filters.type]}`}
                    size="small"
                    onDelete={() => onFiltersChange({ ...filters, type: 'all' })}
                  />
                )}
                {(filters.mine || filters.owner !== 'any') && (
                  <Chip
                    data-testid="filter-chip"
                    label={`Owner: ${ownerSummaryLabel}`}
                    size="small"
                    onDelete={() => onFiltersChange({ ...filters, mine: false, owner: 'any' })}
                  />
                )}
                {searchQ !== '' && (
                  <Chip
                    data-testid="filter-chip"
                    label={`Name: ${searchQuery}`}
                    size="small"
                    onDelete={() => setSearchQuery('')}
                    sx={{
                      bgcolor: (theme) =>
                        theme.palette.mode === 'dark'
                          ? 'rgba(165, 36, 56, 0.22)'
                          : 'rgba(165, 36, 56, 0.08)',
                      color: 'secondary.main',
                      border: '1px solid',
                      borderColor: 'secondary.main',
                      '& .MuiChip-deleteIcon': { color: 'secondary.main' },
                    }}
                  />
                )}
                {[...categoryFilter].map((id) => {
                  const seg = categoryPaths.get(id)
                  const label = seg
                    ? [...seg.ancestors, seg.category].map((cat) => cat.label).join(':')
                    : `Category ${id}`
                  return (
                    <Chip
                      key={`category:${id}`}
                      data-testid="filter-chip"
                      label={`Category: ${label}`}
                      size="small"
                      onDelete={() =>
                        setCategoryFilter((prev) => {
                          const next = new Set(prev)
                          next.delete(id)
                          return next
                        })
                      }
                    />
                  )
                })}
                {[...visibilityFilter].map((v) => (
                  <Chip
                    key={`vis:${v}`}
                    data-testid="filter-chip"
                    label={`Visibility: ${COLLECTION_VISIBILITY_LABELS[v]}`}
                    size="small"
                    onDelete={() =>
                      setVisibilityFilter((prev) => {
                        const next = new Set(prev)
                        next.delete(v)
                        return next
                      })
                    }
                  />
                ))}
              </>
            ) : undefined
          }
          actions={
            // Always rendered so the bar keeps the same height in every
            // view — hidden-but-space-reserving outside table view.
            <Button
              size="small"
              startIcon={<ViewColumnIcon fontSize="small" />}
              aria-label="Choose columns"
              aria-hidden={viewPrefs.view !== 'table'}
              tabIndex={viewPrefs.view === 'table' ? undefined : -1}
              sx={viewPrefs.view === 'table' ? undefined : { visibility: 'hidden' }}
              onClick={() => setColumnDialogOpen(true)}
            >
              Choose columns
            </Button>
          }
        >
          <FilterPopoverButton label="Name" activeCount={searchQ ? 1 : 0}>
            <FilterTextPanel
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Filter by name, description or owner"
              ariaLabel="Filter collections by name"
              helperText={searchHelper}
            />
          </FilterPopoverButton>
          <FilterPopoverButton label="Type" activeCount={filters.type === 'all' ? 0 : 1}>
            <FilterOptionPanel
              multiple={false}
              options={(['sequence', 'synchronized'] as const).map((t) => ({
                value: t,
                label: COLLECTION_TYPE_LABELS[t],
              }))}
              selectedValues={filters.type === 'all' ? [] : [filters.type]}
              onChange={(values) =>
                onFiltersChange({
                  ...filters,
                  type: (values[0] as CollectionType | undefined) ?? 'all',
                })
              }
            />
          </FilterPopoverButton>
          <FilterPopoverButton
            label="Owner"
            activeCount={filters.mine || filters.owner !== 'any' ? 1 : 0}
            panelWidth={280}
          >
            <FilterOptionPanel
              multiple={false}
              options={ownerFacetOptions.map((o) => ({ value: o.value, label: o.label }))}
              selectedValues={ownerSelected}
              onChange={(values) => {
                const choice = ownerFacetOptions.find((o) => o.value === values[0])
                if (choice == null) {
                  onFiltersChange({ ...filters, mine: false, owner: 'any' })
                } else if (choice.filter === 'mine') {
                  onFiltersChange({ ...filters, mine: true, owner: 'any' })
                } else {
                  onFiltersChange({ ...filters, mine: false, owner: choice.filter })
                }
              }}
              searchPlaceholder={ownerFacetOptions.length > 6 ? 'Search owners' : undefined}
            />
          </FilterPopoverButton>
          <FilterPopoverButton label="Visibility" activeCount={visibilityFilter.size}>
            <FilterOptionPanel
              options={(['private', 'public', 'restricted'] as const).map((v) => ({
                value: v,
                label: COLLECTION_VISIBILITY_LABELS[v],
              }))}
              selectedValues={[...visibilityFilter]}
              onChange={(values) => setVisibilityFilter(new Set(values as CollectionVisibility[]))}
            />
          </FilterPopoverButton>
          <FilterPopoverButton label="Category" activeCount={categoryFilter.size} panelWidth={300}>
            <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
              <CategoryFilterTreePanel
                categories={categories}
                selectedIds={categoryFilter}
                onToggle={(id) =>
                  setCategoryFilter((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                  })
                }
              />
            </Box>
          </FilterPopoverButton>
        </FilterBar>

        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <>
            {loading && collections.length === 0 && viewPrefs.view !== 'graph' ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
                <CircularProgress aria-label="Loading collections" />
              </Box>
            ) : shownCollections.length === 0 && viewPrefs.view !== 'graph' ? (
              <Box
                data-testid="collections-empty"
                sx={{ textAlign: 'center', color: 'text.secondary', mt: 8 }}
              >
                <CollectionsIcon sx={{ fontSize: 56, opacity: 0.5 }} />
                <Typography variant="h6" sx={{ mt: 1 }}>
                  {hasActiveFilters ? 'No matching collections' : 'No collections yet'}
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {hasActiveFilters ? (
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
            ) : null}
            {viewPrefs.view === 'cards' && shownCollections.length > 0 && (
              <Box
                data-testid="collections-grid"
                sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}
              >
                {shownCollections.map((c) => {
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
            {viewPrefs.view === 'table' && collections.length > 0 && (
              // Stay mounted (hidden) on a zero-match client filter so the
              // table's local sort/page state survives; the empty-state
              // message above covers the hidden rows.
              <Box sx={{ display: shownCollections.length > 0 ? undefined : 'none' }}>
                <CollectionsTable
                  collections={shownCollections}
                  categoryPaths={categoryPaths}
                  currentUser={currentUser}
                  onOpenCollection={onOpenCollection}
                  renewCoverThumb={renewCoverThumb}
                  columns={orderedVisibleColumns}
                  programs={programs}
                  groups={groups}
                  onNavigateCategory={onNavigateCategory}
                  onEdit={(c) => void openEdit(c)}
                  onManageOwners={setTransferTarget}
                  onToggleHidden={onToggleHidden}
                  onError={onViewerError}
                  selected={selectedIds}
                  onSelectedChange={onBulkUpdate || onBulkDelete ? setSelectedIds : undefined}
                />
              </Box>
            )}
            {/* Graph state (positions, zoom, selection) survives view
                switches and collection round-trips: the canvas stays mounted
                (hidden) once a model exists; positions ride on the model and
                the transform lives for the component's mount (#1627, #1636).
                Order-3 isolated categories render even with zero
                collections, so the graph branch bypasses the empty state. */}
            {/* Graph section fills the remaining page height in graph
                view (#1630 feedback); hidden-but-mounted otherwise so the
                canvas keeps its positions and transform. */}
            <Box
              data-testid="collections-graph-section"
              sx={{
                display: viewPrefs.view === 'graph' ? 'flex' : 'none',
                flexDirection: 'column',
                flex: '1 1 0',
                minHeight: 0,
              }}
            >
              {graphError && (
                <Alert severity="error" sx={{ mb: 1, flexShrink: 0 }}>
                  {graphError}
                </Alert>
              )}
              {!graphModel && !graphError && (
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    flex: '1 1 0',
                  }}
                >
                  <CircularProgress aria-label="Loading collections graph" />
                </Box>
              )}
              {graphModel && (
                <CollectionsGraph
                  model={graphModel}
                  onOpenCollection={onOpenCollection}
                  onOpenImage={onOpenImageById}
                  searchQuery={searchQuery}
                  matchesSearch={(id) => {
                    const c = collections.find((r) => r.id === id)
                    return c != null && matchesClientFilters(c)
                  }}
                  filterActive={visibilityFilter.size > 0 || categoryFilter.size > 0}
                  tooltipInfo={graphTooltipInfo}
                  overlay={
                    <>
                      {/* Order toggle — 1st / 2nd / 3rd (#1627); Shared only
                          needs 2nd order. */}
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={viewPrefs.order}
                        onChange={(_, v: CollectionsGraphOrder | null) => {
                          if (v) setViewPrefs((p) => ({ ...p, order: v }))
                        }}
                        aria-label="Graph order"
                        data-testid="graph-order-toggle"
                        sx={graphToggleSx}
                      >
                        <Tooltip title="Collections">
                          <ToggleButton value={1} aria-label="1st order">
                            1st
                          </ToggleButton>
                        </Tooltip>
                        <Tooltip title="+ images">
                          <ToggleButton value={2} aria-label="2nd order">
                            2nd
                          </ToggleButton>
                        </Tooltip>
                        <Tooltip title="+ categories">
                          <ToggleButton value={3} aria-label="3rd order">
                            3rd
                          </ToggleButton>
                        </Tooltip>
                      </ToggleButtonGroup>
                      <ToggleButton
                        size="small"
                        value="sharedOnly"
                        selected={viewPrefs.sharedOnly}
                        disabled={viewPrefs.order === 1}
                        onChange={() => setViewPrefs((p) => ({ ...p, sharedOnly: !p.sharedOnly }))}
                        aria-label="Shared only"
                        data-testid="graph-shared-only"
                        sx={graphToggleSx}
                      >
                        Shared only
                      </ToggleButton>
                    </>
                  }
                />
              )}
            </Box>
          </>
        )}
      </>
    )
  }

  return (
    <Box
      data-testid="collections-page"
      sx={hasLoadedViewerDetail || graphViewActive ? viewerFlexSx : undefined}
    >
      {editLoadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setEditLoadError(null)}>
          {editLoadError}
        </Alert>
      )}
      {body}

      <ColumnVisibilityDialog
        open={columnDialogOpen}
        title="Choose columns"
        columns={orderedColumnOptions}
        visibleColumns={visibleColumns}
        minimumVisibleColumns={1}
        onClose={() => setColumnDialogOpen(false)}
        onToggleColumn={toggleColumn}
        onReorderColumns={setColumnOrder}
      />

      <CollectionEditDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        collection={editing}
        defaultType={filters.type === 'all' ? 'sequence' : filters.type}
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

      {/* Graph View dialog (#1630) — local perspective graph; its stack is
          dialog-local so the page URL never changes while navigating. */}
      <CollectionGraphDialog
        open={graphDialogOpen && detail != null}
        collectionId={detail?.id ?? 0}
        collectionName={detail?.name ?? ''}
        categoryPaths={categoryPaths}
        onClose={() => setGraphDialogOpen(false)}
        onOpenImage={onOpenImageById ?? (() => undefined)}
        onOpenCollection={(id) => {
          setGraphDialogOpen(false)
          onOpenCollection(id)
        }}
      />

      {/* Bulk edit (#1578) — curator fields for admin/instructor; delete
          requires single-delete authority on every selected row. */}
      <BulkEditCollectionsDialog
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        onSave={async (data) => {
          if (!onBulkUpdate) return
          await onBulkUpdate([...selectedIds], data)
          setBulkEditOpen(false)
          setSelectedIds(new Set())
        }}
        onDelete={async () => {
          if (!onBulkDelete) return
          await onBulkDelete([...selectedIds])
          setBulkEditOpen(false)
          setSelectedIds(new Set())
        }}
        categories={categories}
        selectedCount={selectedIds.size}
        privateSelectedCount={selectedRows.filter((c) => c.visibility === 'private').length}
        canCurate={canFileCollections}
        canDeleteAll={selectedRows.length > 0 && selectedRows.every((c) => c.permissions.canDelete)}
        allCategoryHidden={
          selectedRows.length > 0 &&
          selectedRows.every((c) => {
            const seg = c.categoryId != null ? categoryPaths.get(c.categoryId) : undefined
            return (
              seg != null && getCategoryHiddenStateFromPath([...seg.ancestors, seg.category]).hidden
            )
          })
        }
        programs={programs}
        groups={groups}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleCategoryVisibility}
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
