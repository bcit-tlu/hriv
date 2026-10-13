import { Fragment, useMemo, useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
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
import EditIcon from '@mui/icons-material/Edit'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { userMessage } from '../api'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { describeCollectionOwners } from '../collectionUtils'
import { formatRelativeTime } from '../formatUtils'
import { getInheritedRestrictionSx } from '../restrictionStyles'
import { getVisibilityColors } from '../theme'
import { getCategoryHiddenStateFromPath } from '../treeUtils'
import { useColorMode } from '../useColorMode'
import { useRowsPerPagePreference, ROWS_PER_PAGE_OPTIONS } from '../useRowsPerPagePreference'
import type { Category, CollectionSummary, Group, Program, User } from '../types'
import CategoryBreadcrumb, { type CategoryPathSegment } from './CategoryBreadcrumb'
import { CollectionTypeChip, CollectionVisibilityChip } from './CollectionCard'
import type { ColumnVisibilityOption } from './ColumnVisibilityDialog'
import { filterSurfaceBg } from './FilterPopoverButton'
import RenewingThumbnail from './RenewingThumbnail'

type SortKey =
  | 'id'
  | 'name'
  | 'type'
  | 'scope'
  | 'description'
  | 'category'
  | 'images'
  | 'owner'
  | 'programs'
  | 'groups'
  | 'visibility'
  | 'created'
  | 'updated'

/** Hideable/reorderable columns — the table renders exactly the keys it is
 *  given, in order (#1577 convention, same as the Manage tables). */
export type CollectionsTableColumn =
  | 'cover'
  | 'id'
  | 'name'
  | 'type'
  | 'scope'
  | 'description'
  | 'category'
  | 'images'
  | 'owner'
  | 'programs'
  | 'groups'
  | 'visibility'
  | 'created'
  | 'updated'

// eslint-disable-next-line react-refresh/only-export-components -- column model consumed by CollectionsPage
export const COLLECTIONS_TABLE_COLUMNS: readonly CollectionsTableColumn[] = [
  'cover',
  'id',
  'name',
  'type',
  'scope',
  'description',
  'category',
  'images',
  'owner',
  'programs',
  'groups',
  'visibility',
  'created',
  'updated',
]

// eslint-disable-next-line react-refresh/only-export-components -- column model consumed by CollectionsPage
export const COLLECTIONS_TABLE_COLUMN_OPTIONS: readonly ColumnVisibilityOption<CollectionsTableColumn>[] =
  [
    { key: 'cover', label: 'Cover' },
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'scope', label: 'Scope' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'images', label: 'Images' },
    { key: 'owner', label: 'Owner' },
    { key: 'programs', label: 'Programs' },
    { key: 'groups', label: 'Groups' },
    { key: 'visibility', label: 'Visibility' },
    { key: 'created', label: 'Created' },
    { key: 'updated', label: 'Updated' },
  ]

// eslint-disable-next-line react-refresh/only-export-components -- column model consumed by CollectionsPage
export const DEFAULT_VISIBLE_COLLECTIONS_TABLE_COLUMNS: readonly CollectionsTableColumn[] = [
  'cover',
  'name',
  'type',
  'category',
  'images',
  'owner',
  'updated',
]

/** Curators (admin/instructor) also get the hide/show switch by default. */
// eslint-disable-next-line react-refresh/only-export-components -- column model consumed by CollectionsPage
export const DEFAULT_VISIBLE_CURATOR_COLLECTIONS_TABLE_COLUMNS: readonly CollectionsTableColumn[] =
  ['cover', 'name', 'type', 'category', 'images', 'owner', 'visibility', 'updated']

const SORTABLE_COLUMNS = new Set<CollectionsTableColumn>([
  'id',
  'name',
  'type',
  'scope',
  'description',
  'category',
  'images',
  'owner',
  'programs',
  'groups',
  'visibility',
  'created',
  'updated',
])

export interface CollectionsTableProps {
  collections: CollectionSummary[]
  /** `buildCategoryPaths` output — resolves the Category breadcrumb cell. */
  categoryPaths: Map<number, CategoryPathSegment>
  currentUser: User | null
  onOpenCollection: (id: number) => void
  /** Cover-token renewal keyed by collection id. */
  renewCoverThumb?: (id: number) => Promise<{ id: number; thumb: string | null }>
  /** Visible columns in render order (Choose columns, per-user persisted). */
  columns?: readonly CollectionsTableColumn[]
  /** Programs/groups resolve the restricted-scope chip columns. */
  programs?: Program[]
  groups?: Group[]
  /** Category breadcrumb segment links navigate to Browse. */
  onNavigateCategory?: (categoryPath: Category[]) => void
  /** Row menu Edit — owners (`canEdit`) and curators who can categorize. */
  onEdit?: (collection: CollectionSummary) => void
  /** Row menu Manage owners — `canTransfer`-gated. */
  onManageOwners?: (collection: CollectionSummary) => void
  /** Visibility switch — curatorial hide/show, `canHide`-gated. */
  onToggleHidden?: (collection: CollectionSummary) => Promise<unknown>
  /** Visibility switch failures. */
  onError?: (message: string) => void
  /** Bulk-edit selection (#1578); the selection column renders only when
   *  `onSelectedChange` is wired and some row is selectable. */
  selected?: ReadonlySet<number>
  onSelectedChange?: (selected: Set<number>) => void
}

/**
 * The Collections page's Table view (#1629) — the single collections table
 * since Manage → Collections merged into it. Sortable and paged
 * client-side; hidden and category-hidden rows dim like the Manage Images
 * table. Row click opens the collection; Edit and Manage owners live in the
 * row menu, gated on `collection.permissions`. Column visibility and order
 * come from the page's Choose columns dialog.
 */
export default function CollectionsTable({
  collections,
  categoryPaths,
  currentUser,
  onOpenCollection,
  renewCoverThumb,
  columns = DEFAULT_VISIBLE_COLLECTIONS_TABLE_COLUMNS,
  programs = [],
  groups = [],
  onNavigateCategory,
  onEdit,
  onManageOwners,
  onToggleHidden,
  onError,
  selected,
  onSelectedChange,
}: CollectionsTableProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  // Categorizing is curatorial (admin/instructor) — wider than per-row
  // canEdit: an instructor may refile a colleague's collection through the
  // edit dialog's category picker (#1566/#1567).
  const canFileCollections = currentUser?.role === 'admin' || currentUser?.role === 'instructor'
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useRowsPerPagePreference('collections')
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuCollection, setMenuCollection] = useState<CollectionSummary | null>(null)

  const categoryLabel = (categoryId: number | null): string => {
    if (categoryId == null) return 'Unfiled'
    const seg = categoryPaths.get(categoryId)
    if (!seg) return 'Unfiled'
    return [...seg.ancestors, seg.category].map((c) => c.label).join(' › ')
  }

  // A collection filed under a hidden category is invisible to students
  // regardless of its own `hidden` flag — dim it like the image table's
  // category-hidden rows.
  const isCategoryHidden = (c: CollectionSummary): boolean => {
    if (c.categoryId == null) return false
    const seg = categoryPaths.get(c.categoryId)
    if (!seg) return false
    return getCategoryHiddenStateFromPath([...seg.ancestors, seg.category]).hidden
  }

  // Own scope only when restricted, then the filed category's effective
  // scope (#1567) — shared by the chip cells and their sort keys.
  const scopeIds = (c: CollectionSummary, kind: 'program' | 'group') => {
    const seg = c.categoryId != null ? categoryPaths.get(c.categoryId) : undefined
    const catPath = seg ? [...seg.ancestors, seg.category] : []
    const own =
      c.visibility === 'restricted' ? (kind === 'program' ? c.programIds : c.groupIds) : []
    const inherited = (
      kind === 'program' ? narrowProgramIds(catPath) : narrowGroupIds(catPath)
    ).filter((id) => !own.includes(id))
    return { own, inherited }
  }
  const programName = (id: number) => programs.find((p) => p.id === id)?.name ?? `Program ${id}`
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `Group ${id}`
  const programsLabel = (c: CollectionSummary): string => {
    const { own, inherited } = scopeIds(c, 'program')
    return [...own, ...inherited].map(programName).join(', ')
  }
  const groupsLabel = (c: CollectionSummary): string => {
    const { own, inherited } = scopeIds(c, 'group')
    return [...own, ...inherited].map(groupName).join(', ')
  }

  const sorted = useMemo(() => {
    const rows = [...collections]
    const dir = sortDir === 'asc' ? 1 : -1
    const value = (c: CollectionSummary): string | number => {
      switch (sortKey) {
        case 'id':
          return c.id
        case 'name':
          return c.name.toLowerCase()
        case 'type':
          return c.type
        case 'scope':
          return c.visibility
        case 'description':
          return (c.description ?? '').toLowerCase()
        case 'category':
          return categoryLabel(c.categoryId).toLowerCase()
        case 'images':
          return c.imageCount
        case 'owner':
          return describeCollectionOwners(c.owners).toLowerCase()
        case 'programs':
          return programsLabel(c).toLowerCase()
        case 'groups':
          return groupsLabel(c).toLowerCase()
        case 'visibility':
          // Visible first ascending; own-hidden and category-hidden after.
          return c.hidden || isCategoryHidden(c) ? 1 : 0
        case 'created':
          return c.createdAt
        case 'updated':
          return c.updatedAt
      }
    }
    rows.sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb))
      return cmp !== 0 ? cmp * dir : (a.id - b.id) * dir
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections, sortKey, sortDir, categoryPaths, programs, groups])

  // Clamp the stored index: filters/search shrink `collections` without
  // resetting page state, so the slice and TablePagination must agree on
  // one effective page (#1636 review).
  const effectivePage = Math.min(page, Math.max(0, Math.ceil(sorted.length / rowsPerPage) - 1))
  const pageRows = sorted.slice(
    effectivePage * rowsPerPage,
    effectivePage * rowsPerPage + rowsPerPage,
  )

  // Curators may bulk refile/hide any row; everyone else can only select
  // rows they could delete singly (sole-owner students/staff).
  const rowSelectable = (c: CollectionSummary) => canFileCollections || c.permissions.canDelete
  const selectedIds = selected ?? new Set<number>()
  const selectionEnabled =
    onSelectedChange != null &&
    (canFileCollections || collections.some((c) => c.permissions.canDelete))
  const selectableInView = pageRows.filter(rowSelectable)
  const selectedInView = selectableInView.filter((c) => selectedIds.has(c.id)).length

  const handleSelectAll = (checked: boolean) => {
    const next = new Set(selectedIds)
    for (const c of selectableInView) {
      if (checked) next.add(c.id)
      else next.delete(c.id)
    }
    onSelectedChange?.(next)
  }
  const handleSelectOne = (id: number, checked: boolean) => {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    onSelectedChange?.(next)
  }

  const toggleRowHidden = async (c: CollectionSummary) => {
    if (!onToggleHidden) return
    setTogglingId(c.id)
    try {
      await onToggleHidden(c)
    } catch (err) {
      onError?.(userMessage(err, 'Failed to update collection.'))
    } finally {
      setTogglingId(null)
    }
  }

  const showActions = onEdit != null || onManageOwners != null
  const handleMenuClose = () => {
    setMenuAnchor(null)
    setMenuCollection(null)
  }

  // IDs, counts and timestamps open descending like the old Images/Updated
  // columns; text columns open ascending.
  const DESC_FIRST = new Set<SortKey>(['id', 'images', 'created', 'updated'])

  const headerCell = (column: CollectionsTableColumn, label: string, alignRight = false) => {
    if (!SORTABLE_COLUMNS.has(column)) {
      return (
        <TableCell key={column} align={alignRight ? 'right' : 'left'} sx={{ width: 56 }}>
          {label}
        </TableCell>
      )
    }
    const key = column as SortKey
    return (
      <TableCell
        key={column}
        align={alignRight ? 'right' : 'left'}
        sortDirection={sortKey === key ? sortDir : false}
      >
        <TableSortLabel
          active={sortKey === key}
          direction={sortKey === key ? sortDir : 'asc'}
          onClick={() => {
            if (sortKey === key) {
              setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
            } else {
              setSortKey(key)
              setSortDir(DESC_FIRST.has(key) ? 'desc' : 'asc')
            }
            setPage(0)
          }}
        >
          {label}
        </TableSortLabel>
      </TableCell>
    )
  }

  const columnHeaderCells: Record<CollectionsTableColumn, ReactNode> = {
    cover: headerCell('cover', 'Cover'),
    id: headerCell('id', 'ID'),
    name: headerCell('name', 'Name'),
    type: headerCell('type', 'Type'),
    scope: headerCell('scope', 'Scope'),
    description: headerCell('description', 'Description'),
    category: headerCell('category', 'Category'),
    images: headerCell('images', 'Images', true),
    owner: headerCell('owner', 'Owner'),
    programs: headerCell('programs', 'Programs'),
    groups: headerCell('groups', 'Groups'),
    visibility: headerCell('visibility', 'Visibility'),
    created: headerCell('created', 'Created'),
    updated: headerCell('updated', 'Updated'),
  }

  const bodyCells = (c: CollectionSummary): Record<CollectionsTableColumn, ReactNode> => {
    // Hidden rows dim like ManagePage's inactive images (#1567) — and so do
    // rows hidden by their category subtree.
    const categoryHidden = isCategoryHidden(c)
    const dimmed = c.hidden || categoryHidden
    const dimAttr = dimmed ? { 'data-dimmed': true } : undefined
    const greySx = dimmed ? { filter: 'grayscale(100%)' } : undefined
    // Inherited category scope renders at inherited opacity (#1567).
    const { own: ownProgramIds, inherited: inheritedPrograms } = scopeIds(c, 'program')
    const { own: ownGroupIds, inherited: inheritedGroups } = scopeIds(c, 'group')
    const chipSx = dimmed ? { bgcolor: visColors.inactiveChipBg, color: '#fff' } : {}
    const scopeChips = (
      ownIds: number[],
      inheritedIds: number[],
      kind: 'program' | 'group',
    ): ReactNode => {
      if (ownIds.length === 0 && inheritedIds.length === 0) return '—'
      const label = kind === 'program' ? programName : groupName
      const chip = (id: number, inherited: boolean) => (
        <Chip
          key={`${kind}${id}`}
          data-testid={`${kind}-chip`}
          label={label(id)}
          size="small"
          color={kind === 'program' ? 'primary' : 'secondary'}
          sx={inherited ? getInheritedRestrictionSx(true, chipSx) : chipSx}
        />
      )
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {ownIds.map((id) => chip(id, false))}
          {inheritedIds.map((id) => chip(id, true))}
        </Box>
      )
    }
    return {
      cover: (
        <TableCell sx={{ p: 0.5, width: 56 }}>
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
                ...greySx,
              }}
            />
          ) : null}
        </TableCell>
      ),
      id: <TableCell {...dimAttr}>{c.id}</TableCell>,
      name: (
        <TableCell {...dimAttr}>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Link
              component="button"
              variant="body2"
              underline="hover"
              onClick={(e) => {
                e.stopPropagation()
                onOpenCollection(c.id)
              }}
              sx={{ cursor: 'pointer', textAlign: 'left' }}
            >
              {c.name}
            </Link>
            {/* The eye-off marker is reserved for the collection's own hidden
                flag — category-hidden rows convey the inherited state
                through dimming + the locked switch. */}
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
      ),
      type: (
        <TableCell {...dimAttr}>
          <CollectionTypeChip type={c.type} sx={greySx} />
        </TableCell>
      ),
      scope: (
        <TableCell {...dimAttr}>
          {/* Scope pill only — program/group chips live in their own
              columns, so even a scoped restricted collection keeps its
              label. */}
          <Box component="span" sx={{ display: 'inline-flex', ...greySx }}>
            <CollectionVisibilityChip visibility={c.visibility} hasScopeChips={false} />
          </Box>
        </TableCell>
      ),
      description: (
        <TableCell
          {...dimAttr}
          sx={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={c.description ?? ''}
        >
          {c.description ?? ''}
        </TableCell>
      ),
      category: (
        <TableCell {...dimAttr}>
          <CategoryBreadcrumb
            categoryId={c.categoryId}
            categoryPaths={categoryPaths}
            onNavigate={onNavigateCategory}
            hiddenColor={visColors.inactive}
          />
        </TableCell>
      ),
      images: (
        <TableCell {...dimAttr} align="right">
          {c.imageCount}
        </TableCell>
      ),
      owner: (
        <TableCell {...dimAttr}>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            {describeCollectionOwners(c.owners)}
            {currentUser != null &&
              c.owners.some((o) => o.kind === 'user' && o.userId === currentUser.id) && (
                <Chip
                  size="small"
                  label="You"
                  data-testid="collections-table-you-chip"
                  sx={greySx}
                />
              )}
          </Box>
        </TableCell>
      ),
      programs: (
        <TableCell {...dimAttr}>
          {scopeChips(ownProgramIds, inheritedPrograms, 'program')}
        </TableCell>
      ),
      groups: (
        <TableCell {...dimAttr}>{scopeChips(ownGroupIds, inheritedGroups, 'group')}</TableCell>
      ),
      visibility: (
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Tooltip
            title={
              categoryHidden
                ? 'Hidden by category'
                : c.permissions.canHide
                  ? ''
                  : 'Only admins and instructors can hide collections'
            }
            disableHoverListener={!categoryHidden && c.permissions.canHide}
          >
            <span>
              <Switch
                size="small"
                checked={!c.hidden}
                disabled={
                  categoryHidden ||
                  !c.permissions.canHide ||
                  onToggleHidden == null ||
                  togglingId === c.id
                }
                onChange={() => void toggleRowHidden(c)}
                slotProps={{ input: { 'aria-label': `Visibility for ${c.name}` } }}
              />
            </span>
          </Tooltip>
        </TableCell>
      ),
      created: (
        <TableCell {...dimAttr}>
          <span title={new Date(c.createdAt).toLocaleString()}>
            {formatRelativeTime(c.createdAt)}
          </span>
        </TableCell>
      ),
      updated: (
        <TableCell {...dimAttr}>
          <span title={new Date(c.updatedAt).toLocaleString()}>
            {formatRelativeTime(c.updatedAt)}
          </span>
        </TableCell>
      ),
    }
  }

  return (
    <Box data-testid="collections-table">
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="Collections">
          <TableHead
            sx={{
              // Same head contract as the Manage Images table.
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
                    slotProps={{ input: { 'aria-label': 'Select all collections on this page' } }}
                  />
                </TableCell>
              )}
              {columns.map((column) => (
                <Fragment key={column}>{columnHeaderCells[column]}</Fragment>
              ))}
              {showActions && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((c) => {
              const cells = bodyCells(c)
              return (
                <TableRow
                  key={c.id}
                  hover
                  selected={selectedIds.has(c.id)}
                  data-testid={`collections-table-row-${c.id}`}
                  data-hidden={c.hidden || isCategoryHidden(c) ? 'true' : undefined}
                  sx={{
                    cursor: 'pointer',
                    '& td[data-dimmed]': { color: visColors.inactive },
                    '& td[data-dimmed] a, & td[data-dimmed] button': { color: 'inherit' },
                  }}
                  onClick={() => onOpenCollection(c.id)}
                >
                  {selectionEnabled && (
                    <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(c.id)}
                        disabled={!rowSelectable(c)}
                        onChange={(e) => handleSelectOne(c.id, e.target.checked)}
                        slotProps={{ input: { 'aria-label': `Select ${c.name}` } }}
                      />
                    </TableCell>
                  )}
                  {columns.map((column) => (
                    <Fragment key={column}>{cells[column]}</Fragment>
                  ))}
                  {showActions && (
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${c.name}`}
                        onClick={(e) => {
                          setMenuAnchor(e.currentTarget)
                          setMenuCollection(c)
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={sorted.length}
          page={effectivePage}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(Number.parseInt(e.target.value, 10))
            setPage(0)
          }}
          rowsPerPageOptions={[...ROWS_PER_PAGE_OPTIONS]}
        />
      </TableContainer>

      {/* Row action menu — one kebab per row; items are gated on the target
          row's permissions, so the menu keeps a snapshot of its row. */}
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
        {onEdit && (menuCollection?.permissions.canEdit || canFileCollections) && (
          <MenuItem
            onClick={() => {
              if (menuCollection) onEdit(menuCollection)
              handleMenuClose()
            }}
          >
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </MenuItem>
        )}
        {onManageOwners && menuCollection?.permissions.canTransfer && (
          <MenuItem
            onClick={() => {
              if (menuCollection) onManageOwners(menuCollection)
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
    </Box>
  )
}
