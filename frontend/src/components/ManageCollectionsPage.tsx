import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { visuallyHidden } from '@mui/utils'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import {
  bulkDeleteCollections,
  bulkUpdateCollections,
  createCollection,
  deleteCollection,
  fetchCollection,
  fetchCollections,
  replaceCollectionOwners,
  transferCollection,
  updateCollection,
  userMessage,
} from '../api'
import {
  COLLECTION_TYPE_LABELS,
  COLLECTION_VISIBILITY_LABELS,
  apiCollectionSummaryToSummary,
  apiCollectionToCollection,
  describeCollectionOwner,
  describeCollectionOwners,
} from '../collectionUtils'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { getInheritedRestrictionSx } from '../restrictionStyles'
import { getVisibilityColors } from '../theme'
import { tileOrderingCoordinator } from '../tileOrdering'
import { useColorMode } from '../useColorMode'
import { toCollectionPatch } from '../useCollectionsData'
import { useTableColumnPreferences } from '../useTableColumnPreferences'
import { ROWS_PER_PAGE_OPTIONS, useRowsPerPagePreference } from '../useRowsPerPagePreference'
import {
  getFilterTerms,
  hasFilterTerms,
  matchesTextFilter,
  removeFilterTerm,
} from '../tableFilterUtils'
import {
  getStoredIntSet,
  getStoredTextFilters,
  loadStoredTableFilters,
  useTableFilterPreferences,
} from '../useTableFilterPreferences'
import type {
  Category,
  Collection,
  CollectionSummary,
  CollectionType,
  CollectionVisibility,
  Group,
  Program,
  User,
} from '../types'
import CategoryBreadcrumb, { buildCategoryPaths } from './CategoryBreadcrumb'
import CategoryFilterTreePanel from './CategoryFilterTreePanel'
import BulkEditCollectionsDialog from './BulkEditCollectionsDialog'
import CollectionEditDialog from './CollectionEditDialog'
import type { CollectionFormValues } from './CollectionEditDialog'
import CollectionOwnersDialog from './CollectionOwnersDialog'
import ColumnVisibilityDialog, { type ColumnVisibilityOption } from './ColumnVisibilityDialog'
import { CollectionTypeChip, CollectionVisibilityChip } from './CollectionCard'
import FilterBar from './FilterBar'
import FilterOptionPanel from './FilterOptionPanel'
import FilterPopoverButton, { filterSurfaceBg } from './FilterPopoverButton'
import FilterTextPanel from './FilterTextPanel'
import RenewingThumbnail from './RenewingThumbnail'

type SortableColumn =
  'id' | 'name' | 'type' | 'visibility' | 'owners' | 'images' | 'category' | 'updated_at'
type SortDirection = 'asc' | 'desc'

/** Hideable columns — the Actions column always renders (#1567), same as
 *  ManagePage. `scope` is the Private/Public/Restricted chip; `visibility`
 *  is the show/hide switch (the Manage Images 'Visibility' column). */
type ManageCollectionColumn =
  | 'cover'
  | 'id'
  | 'name'
  | 'type'
  | 'scope'
  | 'owners'
  | 'images'
  | 'programs'
  | 'groups'
  | 'category'
  | 'visibility'
  | 'created_at'
  | 'updated_at'

const MANAGE_COLLECTION_COLUMNS: readonly ManageCollectionColumn[] = [
  'cover',
  'id',
  'name',
  'type',
  'scope',
  'owners',
  'images',
  'programs',
  'groups',
  'category',
  'visibility',
  'created_at',
  'updated_at',
]

const MANAGE_COLLECTION_COLUMN_OPTIONS: readonly ColumnVisibilityOption<ManageCollectionColumn>[] =
  [
    { key: 'cover', label: 'Cover' },
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'scope', label: 'Scope' },
    { key: 'owners', label: 'Owners' },
    { key: 'images', label: 'Images' },
    { key: 'programs', label: 'Programs' },
    { key: 'groups', label: 'Groups' },
    { key: 'category', label: 'Category' },
    { key: 'visibility', label: 'Visibility' },
    { key: 'created_at', label: 'Created' },
    { key: 'updated_at', label: 'Modified' },
  ]

/** Lean default set mirroring ManagePage's six (thumbnail, name, category,
 *  group, visibility, modified) so the table sizes to content and wraps
 *  rather than overflowing into horizontal scroll; everything else is
 *  opt-in via Choose columns (#1567). */
const DEFAULT_VISIBLE_COLLECTION_COLUMNS: readonly ManageCollectionColumn[] = [
  'cover',
  'name',
  'type',
  'category',
  'groups',
  'visibility',
  'updated_at',
]

interface ManageCollectionsStoredFilters {
  text?: Record<string, string>
  types?: unknown
  visibilities?: unknown
  owners?: unknown
  categories?: unknown
}

const TYPE_VALUES: readonly CollectionType[] = ['sequence', 'synchronized']
const VISIBILITY_VALUES: readonly CollectionVisibility[] = ['private', 'public', 'restricted']

/** Owner facet key — `u{id}` for user co-owners, `p{id}` for the program owner. */
function ownerKey(owner: CollectionSummary['owners'][number]): string {
  return owner.kind === 'user' ? `u${owner.userId}` : `p${owner.programId}`
}

function getStoredStringSet<K extends keyof ManageCollectionsStoredFilters>(
  stored: ManageCollectionsStoredFilters | null,
  key: K,
): Set<string> {
  const values = stored?.[key]
  if (!Array.isArray(values)) return new Set<string>()
  return new Set(values.filter((v): v is string => typeof v === 'string'))
}

function getCategoryLabel(
  categoryPaths: ReturnType<typeof buildCategoryPaths>,
  categoryId: number | null,
): string {
  if (categoryId == null) return ''
  const seg = categoryPaths.get(categoryId)
  if (!seg) return String(categoryId)
  return [...seg.ancestors.map((c) => c.label), seg.category.label].join(':')
}

export interface ManageCollectionsPageProps {
  /** Flat category tree (for the Category column + facet). */
  categories: Category[]
  programs: Program[]
  groups: Group[]
  currentUser: User | null
  /**
   * Navigate to a category in Browse (CategoryBreadcrumb segment links) —
   * same contract as ManagePage's `onNavigateCategory`.
   */
  onNavigateCategory?: (categoryPath: Category[]) => void
  /**
   * Category filing saved straight from the Edit dialog's picker (#1566) —
   * routes through the shared move path (POST …/move + snackbar + undo).
   * Superseded the row-level Move affordance.
   */
  onMoveCollectionToCategory?: (
    collection: CollectionSummary,
    categoryId: number | null,
  ) => Promise<unknown>
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
  /** Open the collection detail view (`?collection={id}`) — read-only rows. */
  onOpenCollection: (id: number) => void
  /**
   * Notify the parent after a bulk write changed tile membership —
   * refreshes the category tree/uncategorized list like ManagePage's
   * `onCategoriesChanged` (#1578).
   */
  onCategoriesChanged?: () => void
  /** Route mutation failures to the page-level snackbar. */
  onError?: (message: string) => void
  /**
   * Row loader — defaults to `fetchCollections`. Injectable so Storybook and
   * tests drive the table without mocking the API module (same contract as
   * CollectionsPage's `loadCollection`).
   */
  loadCollections?: typeof fetchCollections
}

/**
 * All-collections manage table (#1554) — mirrors ManagePage's idiom:
 * stored filter facets in a FilterBar, sortable columns, client-side
 * pagination, row actions gated on `collection.permissions`. Delete stays
 * inside the edit dialog, same as EditImageModal.
 *
 * Staff reach this page (same read-level access as the images table) — the
 * API scopes the list; the UI only hides affordances the role can never use.
 */
export default function ManageCollectionsPage({
  categories,
  programs,
  groups,
  currentUser,
  onNavigateCategory,
  onMoveCollectionToCategory,
  onAddCategory,
  onEditCategory,
  onToggleCategoryVisibility,
  onOpenCollection,
  onCategoriesChanged,
  onError,
  loadCollections = fetchCollections,
}: ManageCollectionsPageProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  // Filing is curatorial (admin/instructor) — wider than per-collection
  // canEdit: an instructor may refile a colleague's collection, and the edit
  // dialog's category picker is the filing path now (#1566/#1567).
  const canFileCollections = currentUser?.role === 'admin' || currentUser?.role === 'instructor'

  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const [sortColumn, setSortColumn] = useState<SortableColumn>('id')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Row selection for bulk edit (#1578) — ManagePage's idiom: a checkbox
  // column, page-scoped select-all, and a "Bulk Edit (N selected)" button.
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkEditOpen, setBulkEditOpen] = useState(false)

  const storedFilters = useMemo(
    () => loadStoredTableFilters<ManageCollectionsStoredFilters>('manage-collections'),
    [],
  )
  const [filters, setFilters] = useState<Record<string, string>>(() =>
    getStoredTextFilters(storedFilters),
  )
  const [selectedTypes, setSelectedTypes] = useState<Set<CollectionType>>(
    () =>
      new Set(
        [...getStoredStringSet(storedFilters, 'types')].filter((v): v is CollectionType =>
          (TYPE_VALUES as readonly string[]).includes(v),
        ),
      ),
  )
  const [selectedVisibilities, setSelectedVisibilities] = useState<Set<CollectionVisibility>>(
    () =>
      new Set(
        [...getStoredStringSet(storedFilters, 'visibilities')].filter(
          (v): v is CollectionVisibility => (VISIBILITY_VALUES as readonly string[]).includes(v),
        ),
      ),
  )
  const [selectedOwners, setSelectedOwners] = useState<Set<string>>(() =>
    getStoredStringSet(storedFilters, 'owners'),
  )
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(() =>
    getStoredIntSet(storedFilters, 'categories'),
  )
  const hasActiveFilters =
    Object.values(filters).some((v) => hasFilterTerms(v)) ||
    selectedTypes.size > 0 ||
    selectedVisibilities.size > 0 ||
    selectedOwners.size > 0 ||
    selectedCategories.size > 0

  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      // No API filters — the table facets are client-side like ManagePage's,
      // and the server already scopes the rows to what this role may see.
      const rows = (await loadCollections({})).map(apiCollectionSummaryToSummary)
      if (seq !== loadSeq.current) return
      setCollections(rows)
      // Reconcile the bulk selection against the fresh rows — a collection
      // deleted through its own edit dialog (or hidden by a concurrent
      // change) must drop out so a later bulk call cannot 404 on a stale
      // id (#1578).
      const liveIds = new Set(rows.map((r) => r.id))
      setSelected((prev) => {
        if ([...prev].every((id) => liveIds.has(id))) return prev
        return new Set([...prev].filter((id) => liveIds.has(id)))
      })
      setError(null)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(userMessage(err, 'Failed to load collections.'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [loadCollections])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch trigger
    void load()
  }, [load])

  // A move filed through the shared dialog refreshes the category tree
  // (handleMoveCollection → loadCategories); piggyback on that signal so the
  // Category column updates — including the snackbar's undo path (#1554).
  const firstCategoriesRef = useRef(categories)
  useEffect(() => {
    if (firstCategoriesRef.current === categories) return
    firstCategoriesRef.current = categories
    void load() // refresh after external move/undo — see comment above
  }, [categories, load])

  const filterSnapshot = useMemo(
    () => ({
      text: filters,
      types: [...selectedTypes],
      visibilities: [...selectedVisibilities],
      owners: [...selectedOwners],
      categories: [...selectedCategories],
    }),
    [filters, selectedTypes, selectedVisibilities, selectedOwners, selectedCategories],
  )
  useTableFilterPreferences({ tableKey: 'manage-collections', value: filterSnapshot })

  // Owner facet options come from the loaded rows (plus the admin-visible
  // orphaned state); selecting an owner must not collapse the option list.
  const ownerOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: { value: string; label: string }[] = []
    for (const c of collections) {
      for (const owner of c.owners) {
        const key = ownerKey(owner)
        if (seen.has(key)) continue
        seen.add(key)
        options.push({ value: key, label: describeCollectionOwner(owner) })
      }
    }
    options.sort((a, b) => a.label.localeCompare(b.label))
    return [{ value: 'orphaned', label: 'No owner (orphaned)' }, ...options]
  }, [collections])

  const filteredCollections = useMemo(
    () =>
      collections.filter((c) => {
        if (filters.name && !matchesTextFilter(c.name, filters.name)) return false
        if (selectedTypes.size > 0 && !selectedTypes.has(c.type)) return false
        if (selectedVisibilities.size > 0 && !selectedVisibilities.has(c.visibility)) return false
        if (selectedOwners.size > 0) {
          const keys = c.owners.map(ownerKey)
          const matches =
            (selectedOwners.has('orphaned') && c.owners.length === 0) ||
            keys.some((k) => selectedOwners.has(k))
          if (!matches) return false
        }
        if (selectedCategories.size > 0) {
          // Ancestor-aware, same as the Images table: selecting a parent
          // matches collections filed under any of its descendants.
          if (c.categoryId == null) return false
          const seg = categoryPaths.get(c.categoryId)
          if (!seg) return false
          const candidateIds = new Set<number>([seg.category.id, ...seg.ancestors.map((a) => a.id)])
          if (![...selectedCategories].some((id) => candidateIds.has(id))) return false
        }
        return true
      }),
    [
      collections,
      filters,
      selectedTypes,
      selectedVisibilities,
      selectedOwners,
      selectedCategories,
      categoryPaths,
    ],
  )

  const sortedCollections = useMemo(() => {
    const sorted = [...filteredCollections]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortColumn) {
        case 'id':
          cmp = a.id - b.id
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'type':
          cmp = COLLECTION_TYPE_LABELS[a.type].localeCompare(COLLECTION_TYPE_LABELS[b.type])
          break
        case 'visibility':
          cmp = COLLECTION_VISIBILITY_LABELS[a.visibility].localeCompare(
            COLLECTION_VISIBILITY_LABELS[b.visibility],
          )
          break
        case 'owners':
          cmp = describeCollectionOwners(a.owners).localeCompare(describeCollectionOwners(b.owners))
          break
        case 'images':
          cmp = a.imageCount - b.imageCount
          break
        case 'category':
          cmp = getCategoryLabel(categoryPaths, a.categoryId).localeCompare(
            getCategoryLabel(categoryPaths, b.categoryId),
          )
          break
        case 'updated_at':
          cmp = a.updatedAt.localeCompare(b.updatedAt)
          break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [filteredCollections, sortColumn, sortDirection, categoryPaths])

  // Choose Columns — per-user persisted visibility, same hook + storage
  // convention as ManagePage's `manage-images` table (#1567).
  const { visibleColumns, isColumnVisible, toggleColumn } =
    useTableColumnPreferences<ManageCollectionColumn>({
      tableKey: 'manage-collections',
      allColumns: MANAGE_COLLECTION_COLUMNS,
      defaultVisibleColumns: DEFAULT_VISIBLE_COLLECTION_COLUMNS,
    })
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const visibleColumnCount = MANAGE_COLLECTION_COLUMNS.filter((col) => isColumnVisible(col)).length

  const [rowsPerPage, setRowsPerPage] = useRowsPerPagePreference('manage-collections')
  const [currentPage, setCurrentPage] = useState(0)
  const maxPage = Math.max(0, Math.ceil(sortedCollections.length / rowsPerPage) - 1)
  useEffect(() => {
    if (currentPage > maxPage) {
      setCurrentPage(maxPage) // eslint-disable-line react-hooks/set-state-in-effect -- clamp after filter narrows
    }
  }, [currentPage, maxPage])
  const pageCollections = sortedCollections.slice(
    currentPage * rowsPerPage,
    currentPage * rowsPerPage + rowsPerPage,
  )

  // Curators may bulk refile/hide any row; everyone else can only select
  // rows they could delete singly (sole-owner students/staff). The column
  // only renders when the current user could select anything at all.
  const rowSelectable = useCallback(
    (c: CollectionSummary) => canFileCollections || c.permissions.canDelete,
    [canFileCollections],
  )
  const selectionEnabled = canFileCollections || collections.some((c) => c.permissions.canDelete)
  const selectableInView = useMemo(
    () => pageCollections.filter(rowSelectable),
    [pageCollections, rowSelectable],
  )
  const selectedInView = useMemo(
    () => selectableInView.filter((c) => selected.has(c.id)).length,
    [selectableInView, selected],
  )
  const selectedRows = useMemo(
    () => collections.filter((c) => selected.has(c.id)),
    [collections, selected],
  )

  const handleSelectAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of selectableInView) {
        if (checked) next.add(c.id)
        else next.delete(c.id)
      }
      return next
    })
  }

  const handleSelectOne = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Bulk handlers (#1578) — same shape as ManagePage's: the API applies the
  // diff atomically; a category move also invalidates every affected
  // tile-order scope so a cached revision can't falsely 409 a reorder.
  const handleBulkSave = async (data: { category_id?: number | null; hidden?: boolean }) => {
    try {
      await bulkUpdateCollections({ collection_ids: [...selected], ...data })
      if (data.category_id !== undefined) {
        const affected = new Set<number | null>()
        for (const c of collections) {
          if (selected.has(c.id) && (c.categoryId ?? null) !== data.category_id) {
            affected.add(c.categoryId ?? null)
            affected.add(data.category_id)
          }
        }
        for (const scope of affected) tileOrderingCoordinator.invalidateRevision(scope)
      }
      setBulkEditOpen(false)
      setSelected(new Set())
      await load()
      onCategoriesChanged?.()
    } catch (err) {
      console.error('Failed to bulk update collections', err)
      throw err
    }
  }

  const handleBulkDelete = async () => {
    try {
      await bulkDeleteCollections({ collection_ids: [...selected] })
      setBulkEditOpen(false)
      setSelected(new Set())
      await load()
      onCategoriesChanged?.()
    } catch (err) {
      console.error('Failed to bulk delete collections', err)
      throw err
    }
  }

  const handleSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const handleClearFilters = () => {
    setFilters({})
    setSelectedTypes(new Set())
    setSelectedVisibilities(new Set())
    setSelectedOwners(new Set())
    setSelectedCategories(new Set())
    setCurrentPage(0)
  }

  const handleRemoveFilterTerm = (key: string, term: string) => {
    setFilters((prev) => ({ ...prev, [key]: removeFilterTerm(prev[key] ?? '', term) }))
    setCurrentPage(0)
  }

  // ── Dialogs ──────────────────────────────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [ownersTarget, setOwnersTarget] = useState<CollectionSummary | null>(null)
  const editRequestRef = useRef(0)
  // Single kebab menu per row — the ManagePage pattern (#1567).
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuCollection, setMenuCollection] = useState<CollectionSummary | null>(null)

  const openEdit = async (summary: CollectionSummary) => {
    const request = ++editRequestRef.current
    try {
      const full = apiCollectionToCollection(await fetchCollection(summary.id))
      if (request !== editRequestRef.current) return
      setEditing(full)
      setEditorOpen(true)
    } catch (err) {
      if (request !== editRequestRef.current) return
      onError?.(userMessage(err, 'Failed to load collection.'))
    }
  }

  const handleSave = async (
    values: CollectionFormValues,
    version: number | null,
    baseline: Collection | null,
  ) => {
    try {
      if (editing && version != null) {
        // PATCH only real field diffs (#1567 review): a version-only body is
        // a content write the backend 403s for filing-only curators (and a
        // no-op bump for everyone else). A hidden-only diff still PATCHes —
        // hide is curatorial, not owner-scoped.
        const patch = toCollectionPatch(values, baseline, version)
        const updated = Object.keys(patch).some((k) => k !== 'version')
          ? apiCollectionToCollection(await updateCollection(editing.id, patch))
          : editing
        // Advance the record the dialog is seeded from (#1567): if the
        // chained move below fails, the editor stays open with
        // baseline/version already at the saved state — a retry diffs clean
        // instead of replaying a stale-version PATCH.
        setEditing(updated)
        // Category filing is a move, not a PATCH (#1566) — apply it after the
        // metadata save so the move posts the just-refreshed version. A failed
        // move must not read as a successful save: the move op already showed
        // its error snackbar, so rethrow the API error — the dialog stays open
        // with the real message (and its 409 conflict-reload path) (#1567).
        if (values.categoryId !== (baseline?.categoryId ?? null)) {
          const moved = await onMoveCollectionToCategory?.(updated, values.categoryId)
          if (moved instanceof Error) throw moved
        }
      } else {
        await createCollection({
          name: values.name,
          description: values.description,
          type: values.type,
          visibility: values.visibility,
          image_ids: [],
          ...(values.visibility === 'restricted'
            ? { program_ids: values.programIds, group_ids: values.groupIds }
            : {}),
        })
      }
    } finally {
      // Refresh even when the save/move chain throws — a partial success
      // (metadata saved, move failed) still changed the row.
      void load()
    }
  }

  // Delete lives inside the edit dialog only (#1554) — EditImageModal's
  // confirm pattern; the caller (dialog) closes on success.
  const deleteFromDialog = async () => {
    if (!editing) return
    await deleteCollection(editing.id)
    setEditorOpen(false)
    void load()
  }

  // Owners/transfer carry `version` — fetch the fresh record rather than
  // trusting the table row (another editor may have bumped it, #1531).
  const saveOwners = async (id: number, userIds: number[]) => {
    const fresh = await fetchCollection(id)
    await replaceCollectionOwners(id, { user_ids: userIds, version: fresh.version })
    void load()
  }
  const transfer = async (id: number, programId: number | null) => {
    const fresh = await fetchCollection(id)
    await transferCollection(id, { program_id: programId, version: fresh.version })
    void load()
  }

  const handleRowClick = (c: CollectionSummary) => {
    // Mirror ManagePage: row click opens the editor — for owners, and for
    // curators who can file but not edit (the dialog's category picker is
    // the filing affordance, #1567). Other read-only rows open the view.
    if (c.permissions.canEdit || canFileCollections) void openEdit(c)
    else onOpenCollection(c.id)
  }

  // Row Visibility switch (#1567): curatorial hide/show, same PATCH path
  // the detail header's Hide link uses — refetch keeps OCC versions fresh.
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const toggleRowHidden = async (c: CollectionSummary) => {
    setTogglingId(c.id)
    try {
      await updateCollection(c.id, { hidden: !c.hidden, version: c.version })
    } catch (err) {
      onError?.(userMessage(err, 'Failed to update collection.'))
    } finally {
      setTogglingId(null)
      void load()
    }
  }

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, c: CollectionSummary) => {
    setMenuAnchor(e.currentTarget)
    setMenuCollection(c)
  }
  const handleMenuClose = () => {
    setMenuAnchor(null)
    setMenuCollection(null)
  }

  const renewCoverThumb = useCallback(
    (id: number): Promise<{ id: number; thumb: string | null }> =>
      fetchCollection(id).then((c) => ({ id: c.id, thumb: c.cover_thumb })),
    [],
  )

  const selectedTypeLabels = [...selectedTypes].map((t) => COLLECTION_TYPE_LABELS[t])
  const selectedVisibilityLabels = [...selectedVisibilities].map(
    (v) => COLLECTION_VISIBILITY_LABELS[v],
  )
  const selectedOwnerLabels = [...selectedOwners].map(
    (k) => ownerOptions.find((o) => o.value === k)?.label ?? k,
  )
  const selectedCategoryOptions = [...selectedCategories].map((id) => ({
    id,
    label: getCategoryLabel(categoryPaths, id) || `Category ${id}`,
  }))

  return (
    <Box data-testid="manage-collections-page">
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
        <Box sx={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
          {selected.size > 0 && (
            <Button
              variant="contained"
              color="secondary"
              size="small"
              onClick={() => setBulkEditOpen(true)}
            >
              Bulk Edit ({selected.size} selected)
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              // Cancel any in-flight openEdit fetch so it can't replace the
              // create form when it resolves.
              editRequestRef.current++
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            New collection
          </Button>
        </Box>
      </Box>

      <FilterBar
        clearAction={
          hasActiveFilters ? (
            <Button
              size="small"
              color="secondary"
              onClick={handleClearFilters}
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
              {Object.entries(filters)
                .filter(([, value]) => hasFilterTerms(value))
                .map(([key, value]) =>
                  getFilterTerms(value).map((term) => (
                    <Chip
                      key={`${key}:${term}`}
                      data-testid="filter-chip"
                      label={`${key === 'name' ? 'Name' : key}: ${term}`}
                      size="small"
                      onDelete={() => handleRemoveFilterTerm(key, term)}
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
                  )),
                )}
              {selectedTypeLabels.map((label, i) => (
                <Chip
                  key={`type:${[...selectedTypes][i]}`}
                  data-testid="filter-chip"
                  label={`Type: ${label}`}
                  size="small"
                  onDelete={() => {
                    setSelectedTypes((prev) => {
                      const next = new Set(prev)
                      next.delete([...prev][i])
                      return next
                    })
                    setCurrentPage(0)
                  }}
                />
              ))}
              {selectedVisibilityLabels.map((label, i) => (
                <Chip
                  key={`vis:${[...selectedVisibilities][i]}`}
                  data-testid="filter-chip"
                  label={`Visibility: ${label}`}
                  size="small"
                  onDelete={() => {
                    setSelectedVisibilities((prev) => {
                      const next = new Set(prev)
                      next.delete([...prev][i])
                      return next
                    })
                    setCurrentPage(0)
                  }}
                />
              ))}
              {selectedOwnerLabels.map((label, i) => (
                <Chip
                  key={`owner:${[...selectedOwners][i]}`}
                  data-testid="filter-chip"
                  label={`Owner: ${label}`}
                  size="small"
                  onDelete={() => {
                    setSelectedOwners((prev) => {
                      const next = new Set(prev)
                      next.delete([...prev][i])
                      return next
                    })
                    setCurrentPage(0)
                  }}
                />
              ))}
              {selectedCategoryOptions.map((category) => (
                <Chip
                  key={`category:${category.id}`}
                  data-testid="filter-chip"
                  label={`Category: ${category.label}`}
                  size="small"
                  onDelete={() => {
                    setSelectedCategories((prev) => {
                      const next = new Set(prev)
                      next.delete(category.id)
                      return next
                    })
                    setCurrentPage(0)
                  }}
                />
              ))}
            </>
          ) : undefined
        }
        actions={
          <Button
            size="small"
            startIcon={<ViewColumnIcon fontSize="small" />}
            aria-label="Choose columns"
            onClick={() => setColumnDialogOpen(true)}
          >
            Choose columns
          </Button>
        }
      >
        <FilterPopoverButton
          label="Name"
          activeCount={filters.name ? getFilterTerms(filters.name).length : 0}
        >
          <FilterTextPanel
            value={filters.name ?? ''}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, name: value }))
              setCurrentPage(0)
            }}
            placeholder="Filter by name"
            ariaLabel="Filter collections by name"
          />
        </FilterPopoverButton>
        <FilterPopoverButton label="Type" activeCount={selectedTypes.size}>
          <FilterOptionPanel
            options={TYPE_VALUES.map((t) => ({ value: t, label: COLLECTION_TYPE_LABELS[t] }))}
            selectedValues={[...selectedTypes]}
            onChange={(values) => {
              setSelectedTypes(new Set(values as CollectionType[]))
              setCurrentPage(0)
            }}
          />
        </FilterPopoverButton>
        <FilterPopoverButton label="Visibility" activeCount={selectedVisibilities.size}>
          <FilterOptionPanel
            options={VISIBILITY_VALUES.map((v) => ({
              value: v,
              label: COLLECTION_VISIBILITY_LABELS[v],
            }))}
            selectedValues={[...selectedVisibilities]}
            onChange={(values) => {
              setSelectedVisibilities(new Set(values as CollectionVisibility[]))
              setCurrentPage(0)
            }}
          />
        </FilterPopoverButton>
        <FilterPopoverButton label="Owner" activeCount={selectedOwners.size} panelWidth={280}>
          <FilterOptionPanel
            options={ownerOptions}
            selectedValues={[...selectedOwners]}
            onChange={(values) => {
              setSelectedOwners(new Set(values))
              setCurrentPage(0)
            }}
            searchPlaceholder="Search owners"
          />
        </FilterPopoverButton>
        <FilterPopoverButton
          label="Category"
          activeCount={selectedCategories.size}
          panelWidth={300}
        >
          <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
            <CategoryFilterTreePanel
              categories={categories}
              selectedIds={selectedCategories}
              onToggle={(id) => {
                setSelectedCategories((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
                setCurrentPage(0)
              }}
            />
          </Box>
        </FilterPopoverButton>
      </FilterBar>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" data-testid="manage-collections-table">
          <TableHead
            sx={{
              // Same selector + sizing contract as ManagePage's table head.
              '& .MuiTableCell-head': { bgcolor: (theme) => filterSurfaceBg(theme) },
              '& th': { fontWeight: 600 },
            }}
          >
            <TableRow>
              {selectionEnabled && (
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selectedInView > 0 && selectedInView < selectableInView.length}
                    checked={
                      selectableInView.length > 0 && selectedInView === selectableInView.length
                    }
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    slotProps={{
                      input: { 'aria-label': 'Select all collections on this page' },
                    }}
                  />
                </TableCell>
              )}
              {isColumnVisible('cover') && (
                <TableCell sx={{ width: 48, p: 0.5 }}>
                  <Box component="span" sx={visuallyHidden}>
                    Cover
                  </Box>
                </TableCell>
              )}
              {isColumnVisible('id') && (
                <TableCell sortDirection={sortColumn === 'id' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'id'}
                    direction={sortColumn === 'id' ? sortDirection : 'asc'}
                    onClick={() => handleSort('id')}
                  >
                    ID
                  </TableSortLabel>
                </TableCell>
              )}
              {isColumnVisible('name') && (
                <TableCell sortDirection={sortColumn === 'name' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'name'}
                    direction={sortColumn === 'name' ? sortDirection : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    Name
                  </TableSortLabel>
                </TableCell>
              )}
              {isColumnVisible('type') && (
                <TableCell sortDirection={sortColumn === 'type' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'type'}
                    direction={sortColumn === 'type' ? sortDirection : 'asc'}
                    onClick={() => handleSort('type')}
                  >
                    Type
                  </TableSortLabel>
                </TableCell>
              )}
              {isColumnVisible('scope') && (
                <TableCell sortDirection={sortColumn === 'visibility' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'visibility'}
                    direction={sortColumn === 'visibility' ? sortDirection : 'asc'}
                    onClick={() => handleSort('visibility')}
                  >
                    Scope
                  </TableSortLabel>
                </TableCell>
              )}
              {isColumnVisible('owners') && (
                <TableCell sortDirection={sortColumn === 'owners' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'owners'}
                    direction={sortColumn === 'owners' ? sortDirection : 'asc'}
                    onClick={() => handleSort('owners')}
                  >
                    Owners
                  </TableSortLabel>
                </TableCell>
              )}
              {isColumnVisible('images') && (
                <TableCell sortDirection={sortColumn === 'images' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'images'}
                    direction={sortColumn === 'images' ? sortDirection : 'asc'}
                    onClick={() => handleSort('images')}
                  >
                    Images
                  </TableSortLabel>
                </TableCell>
              )}
              {isColumnVisible('programs') && <TableCell>Programs</TableCell>}
              {isColumnVisible('groups') && <TableCell>Groups</TableCell>}
              {isColumnVisible('category') && (
                <TableCell sortDirection={sortColumn === 'category' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'category'}
                    direction={sortColumn === 'category' ? sortDirection : 'asc'}
                    onClick={() => handleSort('category')}
                  >
                    Category
                  </TableSortLabel>
                </TableCell>
              )}
              {isColumnVisible('visibility') && <TableCell>Visibility</TableCell>}
              {isColumnVisible('created_at') && <TableCell>Created</TableCell>}
              {isColumnVisible('updated_at') && (
                <TableCell sortDirection={sortColumn === 'updated_at' ? sortDirection : false}>
                  <TableSortLabel
                    active={sortColumn === 'updated_at'}
                    direction={sortColumn === 'updated_at' ? sortDirection : 'asc'}
                    onClick={() => handleSort('updated_at')}
                  >
                    Modified
                  </TableSortLabel>
                </TableCell>
              )}
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageCollections.map((c) => {
              // Hidden rows dim like ManagePage's inactive images (#1567).
              const dimAttr = c.hidden ? { 'data-dimmed': true } : undefined
              const catPath = c.categoryId != null ? categoryPaths.get(c.categoryId) : undefined
              const catCategories = catPath ? [...catPath.ancestors, catPath.category] : []
              // Own scope chips only when restricted; the filed category's
              // effective scope renders dimmed beneath them (#1567).
              const ownProgramIds = c.visibility === 'restricted' ? c.programIds : []
              const ownGroupIds = c.visibility === 'restricted' ? c.groupIds : []
              const ownProgramSet = new Set(ownProgramIds)
              const ownGroupSet = new Set(ownGroupIds)
              const inheritedPrograms = narrowProgramIds(catCategories).filter(
                (id) => !ownProgramSet.has(id),
              )
              const inheritedGroups = narrowGroupIds(catCategories).filter(
                (id) => !ownGroupSet.has(id),
              )
              const chipSx = c.hidden ? { bgcolor: visColors.inactiveChipBg, color: '#fff' } : {}
              return (
                <TableRow
                  key={c.id}
                  hover
                  selected={selected.has(c.id)}
                  data-testid={`manage-collection-row-${c.id}`}
                  sx={{
                    cursor: 'pointer',
                    '& td[data-dimmed]': { color: visColors.inactive },
                    '& td[data-dimmed] a, & td[data-dimmed] button': { color: 'inherit' },
                  }}
                  onClick={() => handleRowClick(c)}
                >
                  {selectionEnabled && (
                    <TableCell
                      data-interactive="true"
                      padding="checkbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={selected.has(c.id)}
                        disabled={!rowSelectable(c)}
                        onChange={(e) => handleSelectOne(c.id, e.target.checked)}
                        slotProps={{
                          input: { 'aria-label': `Select ${c.name}` },
                        }}
                      />
                    </TableCell>
                  )}
                  {isColumnVisible('cover') && (
                    <TableCell
                      data-interactive="true"
                      sx={{ p: 0.5 }}
                      onClick={(e) => {
                        // Thumbnail navigates to the collection — the Manage
                        // Images table's cover contract (#1567).
                        e.stopPropagation()
                        onOpenCollection(c.id)
                      }}
                    >
                      {c.coverThumb ? (
                        <RenewingThumbnail
                          image={{ id: c.id, thumb: c.coverThumb }}
                          renewThumb={renewCoverThumb}
                          alt={c.name}
                          sx={{
                            width: 40,
                            height: 40,
                            objectFit: 'cover',
                            borderRadius: 0.5,
                            display: 'block',
                            cursor: 'pointer',
                            ...(c.hidden ? { filter: 'grayscale(100%)' } : {}),
                          }}
                        />
                      ) : null}
                    </TableCell>
                  )}
                  {isColumnVisible('id') && <TableCell {...dimAttr}>{c.id}</TableCell>}
                  {isColumnVisible('name') && (
                    <TableCell {...dimAttr}>
                      <Box
                        component="span"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                      >
                        {c.name}
                        {c.hidden && (
                          <Tooltip title="Visibility: Hidden">
                            <span
                              role="img"
                              aria-label="Visibility: Hidden"
                              style={{ display: 'inline-flex', flexShrink: 0 }}
                            >
                              <VisibilityOffIcon sx={{ fontSize: 14, color: visColors.inactive }} />
                            </span>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                  )}
                  {isColumnVisible('type') && (
                    <TableCell {...dimAttr}>
                      {/* Shared type pill — same red-outlined icon chip as
                          the tile overlay and detail header (#1567). */}
                      <CollectionTypeChip
                        type={c.type}
                        sx={c.hidden ? { filter: 'grayscale(100%)' } : undefined}
                      />
                    </TableCell>
                  )}
                  {isColumnVisible('scope') && (
                    <TableCell {...dimAttr}>
                      <CollectionVisibilityChip
                        visibility={c.visibility}
                        hasScopeChips={c.programIds.length + c.groupIds.length > 0}
                      />
                    </TableCell>
                  )}
                  {isColumnVisible('owners') && (
                    <TableCell {...dimAttr}>{describeCollectionOwners(c.owners)}</TableCell>
                  )}
                  {isColumnVisible('images') && <TableCell {...dimAttr}>{c.imageCount}</TableCell>}
                  {isColumnVisible('programs') && (
                    <TableCell {...dimAttr} onClick={(e) => e.stopPropagation()}>
                      {ownProgramIds.length === 0 && inheritedPrograms.length === 0 ? (
                        '—'
                      ) : (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {ownProgramIds.map((pid) => (
                            <Chip
                              key={`p${pid}`}
                              data-testid="program-chip"
                              label={programs.find((p) => p.id === pid)?.name ?? `Program ${pid}`}
                              size="small"
                              color="primary"
                              sx={chipSx}
                            />
                          ))}
                          {inheritedPrograms.map((pid) => (
                            <Chip
                              key={`p${pid}`}
                              data-testid="program-chip"
                              label={programs.find((p) => p.id === pid)?.name ?? `Program ${pid}`}
                              size="small"
                              color="primary"
                              sx={getInheritedRestrictionSx(true, chipSx)}
                            />
                          ))}
                        </Box>
                      )}
                    </TableCell>
                  )}
                  {isColumnVisible('groups') && (
                    <TableCell {...dimAttr} onClick={(e) => e.stopPropagation()}>
                      {ownGroupIds.length === 0 && inheritedGroups.length === 0 ? (
                        '—'
                      ) : (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {ownGroupIds.map((gid) => (
                            <Chip
                              key={`g${gid}`}
                              data-testid="group-chip"
                              label={groups.find((g) => g.id === gid)?.name ?? `Group ${gid}`}
                              size="small"
                              color="secondary"
                              sx={chipSx}
                            />
                          ))}
                          {inheritedGroups.map((gid) => (
                            <Chip
                              key={`g${gid}`}
                              data-testid="group-chip"
                              label={groups.find((g) => g.id === gid)?.name ?? `Group ${gid}`}
                              size="small"
                              color="secondary"
                              sx={getInheritedRestrictionSx(true, chipSx)}
                            />
                          ))}
                        </Box>
                      )}
                    </TableCell>
                  )}
                  {isColumnVisible('category') && (
                    <TableCell {...dimAttr}>
                      <CategoryBreadcrumb
                        categoryId={c.categoryId}
                        categoryPaths={categoryPaths}
                        onNavigate={onNavigateCategory}
                        hiddenColor={visColors.inactive}
                      />
                    </TableCell>
                  )}
                  {isColumnVisible('visibility') && (
                    <TableCell data-interactive="true" onClick={(e) => e.stopPropagation()}>
                      <Tooltip
                        title={
                          c.permissions.canHide
                            ? ''
                            : 'Only admins and instructors can hide collections'
                        }
                        disableHoverListener={c.permissions.canHide}
                      >
                        <span>
                          <Switch
                            size="small"
                            checked={!c.hidden}
                            disabled={!c.permissions.canHide || togglingId === c.id}
                            onChange={() => void toggleRowHidden(c)}
                            slotProps={{
                              input: { 'aria-label': `Visibility for ${c.name}` },
                            }}
                          />
                        </span>
                      </Tooltip>
                    </TableCell>
                  )}
                  {isColumnVisible('created_at') && (
                    <TableCell {...dimAttr}>{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                  )}
                  {isColumnVisible('updated_at') && (
                    <TableCell {...dimAttr}>{new Date(c.updatedAt).toLocaleDateString()}</TableCell>
                  )}
                  <TableCell
                    align="right"
                    data-interactive="true"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconButton
                      size="small"
                      aria-label={`Actions for ${c.name}`}
                      onClick={(e) => handleMenuOpen(e, c)}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              )
            })}
            {pageCollections.length === 0 && !loading && (
              <TableRow>
                <TableCell
                  colSpan={visibleColumnCount + (selectionEnabled ? 2 : 1)}
                  align="center"
                  sx={{ py: 4, color: 'text.secondary' }}
                >
                  {hasActiveFilters
                    ? 'No collections match the current filters.'
                    : 'No collections yet.'}
                </TableCell>
              </TableRow>
            )}
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={visibleColumnCount + (selectionEnabled ? 2 : 1)}
                  align="center"
                  sx={{ py: 4 }}
                >
                  <CircularProgress size={24} aria-label="Loading collections" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {/* Pagination inside the TableContainer — ManagePage's structure,
            so the container width contract is identical (#1567). */}
        <TablePagination
          component="div"
          count={sortedCollections.length}
          page={Math.min(currentPage, maxPage)}
          onPageChange={(_e, p) => setCurrentPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10))
            setCurrentPage(0)
          }}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
        />
      </TableContainer>

      {/* Row action menu — one kebab per row, ManagePage-style (#1567).
          Items are gated on the target row's permissions, so the menu keeps
          a snapshot of the collection it was opened for. */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
        <MenuItem
          onClick={() => {
            if (menuCollection) onOpenCollection(menuCollection.id)
            handleMenuClose()
          }}
        >
          <ListItemIcon>
            <VisibilityIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View</ListItemText>
        </MenuItem>
        {(menuCollection?.permissions.canEdit || canFileCollections) && (
          <MenuItem
            onClick={() => {
              if (menuCollection) void openEdit(menuCollection)
              handleMenuClose()
            }}
          >
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </MenuItem>
        )}
        {menuCollection?.permissions.canTransfer && (
          <MenuItem
            onClick={() => {
              if (menuCollection) setOwnersTarget(menuCollection)
              handleMenuClose()
            }}
          >
            <ListItemIcon>
              <SwapHorizIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Manage owners</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <ColumnVisibilityDialog
        open={columnDialogOpen}
        title="Choose collection table columns"
        columns={MANAGE_COLLECTION_COLUMN_OPTIONS}
        visibleColumns={visibleColumns}
        onClose={() => setColumnDialogOpen(false)}
        onToggleColumn={toggleColumn}
      />

      {/* Bulk edit (#1578) — curator fields when admin/instructor; delete
          requires single-delete authority on every selected row. */}
      <BulkEditCollectionsDialog
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        onSave={handleBulkSave}
        onDelete={handleBulkDelete}
        categories={categories}
        selectedCount={selected.size}
        canCurate={canFileCollections}
        canDeleteAll={selectedRows.length > 0 && selectedRows.every((c) => c.permissions.canDelete)}
        programs={programs}
        groups={groups}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleCategoryVisibility}
      />

      <CollectionEditDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        collection={editing}
        defaultType={selectedTypes.size === 1 ? [...selectedTypes][0] : 'sequence'}
        programs={programs}
        groups={groups}
        onSave={handleSave}
        onDelete={editing?.permissions.canDelete ? deleteFromDialog : undefined}
        categories={categories}
        onAddCategory={onAddCategory}
        onEditCategory={onEditCategory}
        onToggleVisibility={onToggleCategoryVisibility}
      />

      <CollectionOwnersDialog
        open={ownersTarget != null}
        onClose={() => setOwnersTarget(null)}
        collection={ownersTarget}
        programs={programs}
        onSaveOwners={saveOwners}
        onTransfer={transfer}
      />
    </Box>
  )
}
