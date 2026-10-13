import { Fragment, useMemo, useState, type ReactNode } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import { describeCollectionOwners } from '../collectionUtils'
import { formatRelativeTime } from '../formatUtils'
import { useRowsPerPagePreference, ROWS_PER_PAGE_OPTIONS } from '../useRowsPerPagePreference'
import type { CollectionSummary, Group, Program, User } from '../types'
import type { CategoryPathSegment } from './CategoryBreadcrumb'
import { CollectionTypeChip, CollectionVisibilityChip } from './CollectionCard'
import type { ColumnVisibilityOption } from './ColumnVisibilityDialog'
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
  'created',
  'updated',
])

export interface CollectionsTableProps {
  collections: CollectionSummary[]
  /** `buildCategoryPaths` output — resolves the Category breadcrumb cell. */
  categoryPaths: Map<number, CategoryPathSegment>
  currentUser: User | null
  onOpenCollection: (id: number) => void
  /** Cover-token renewal keyed by collection id (same as Manage → Collections). */
  renewCoverThumb?: (id: number) => Promise<{ id: number; thumb: string | null }>
  /** Visible columns in render order (Choose columns, per-user persisted). */
  columns?: readonly CollectionsTableColumn[]
  /** Programs/groups resolve the restricted-scope name columns. */
  programs?: Program[]
  groups?: Group[]
}

/**
 * The Collections page's Table view (#1629): a pared-down Manage →
 * Collections table — sortable and paged client-side, with no bulk actions
 * or edit controls. Row click opens the collection. Column visibility and
 * order come from the page's Choose columns dialog.
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
}: CollectionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useRowsPerPagePreference('collections')

  const categoryLabel = (categoryId: number | null): string => {
    if (categoryId == null) return 'Unfiled'
    const seg = categoryPaths.get(categoryId)
    if (!seg) return 'Unfiled'
    // Breadcrumb without the root, matching the card's location line.
    return [...seg.ancestors, seg.category].map((c) => c.label).join(' › ')
  }

  const programsLabel = (c: CollectionSummary): string =>
    c.programIds.map((id) => programs.find((p) => p.id === id)?.name ?? `Program ${id}`).join(', ')
  const groupsLabel = (c: CollectionSummary): string =>
    c.groupIds.map((id) => groups.find((g) => g.id === id)?.name ?? `Group ${id}`).join(', ')

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
    created: headerCell('created', 'Created'),
    updated: headerCell('updated', 'Updated'),
  }

  const bodyCells = (c: CollectionSummary): Record<CollectionsTableColumn, ReactNode> => ({
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
            }}
          />
        ) : null}
      </TableCell>
    ),
    id: <TableCell>{c.id}</TableCell>,
    name: (
      <TableCell>
        <Link
          component="button"
          variant="body2"
          underline="hover"
          onClick={(e) => {
            e.stopPropagation()
            onOpenCollection(c.id)
          }}
          sx={{ cursor: 'pointer' }}
        >
          {c.name}
        </Link>
      </TableCell>
    ),
    type: (
      <TableCell>
        <CollectionTypeChip type={c.type} />
      </TableCell>
    ),
    scope: (
      <TableCell>
        {/* Scope pill only — the table shows no program/group chips beside
            it, so even a scoped restricted collection keeps its label. */}
        <CollectionVisibilityChip visibility={c.visibility} hasScopeChips={false} />
      </TableCell>
    ),
    description: (
      <TableCell
        sx={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={c.description ?? ''}
      >
        {c.description ?? ''}
      </TableCell>
    ),
    category: <TableCell>{categoryLabel(c.categoryId)}</TableCell>,
    images: <TableCell align="right">{c.imageCount}</TableCell>,
    owner: (
      <TableCell>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          {describeCollectionOwners(c.owners)}
          {currentUser != null &&
            c.owners.some((o) => o.kind === 'user' && o.userId === currentUser.id) && (
              <Chip size="small" label="You" data-testid="collections-table-you-chip" />
            )}
        </Box>
      </TableCell>
    ),
    programs: <TableCell>{programsLabel(c)}</TableCell>,
    groups: <TableCell>{groupsLabel(c)}</TableCell>,
    created: (
      <TableCell>
        <span title={new Date(c.createdAt).toLocaleString()}>
          {formatRelativeTime(c.createdAt)}
        </span>
      </TableCell>
    ),
    updated: (
      <TableCell>
        <span title={new Date(c.updatedAt).toLocaleString()}>
          {formatRelativeTime(c.updatedAt)}
        </span>
      </TableCell>
    ),
  })

  return (
    <Box data-testid="collections-table">
      <TableContainer>
        <Table size="small" aria-label="Collections">
          <TableHead>
            <TableRow>{columns.map((column) => columnHeaderCells[column])}</TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((c) => {
              const cells = bodyCells(c)
              return (
                <TableRow
                  key={c.id}
                  hover
                  data-testid={`collections-table-row-${c.id}`}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => onOpenCollection(c.id)}
                >
                  {columns.map((column) => (
                    <Fragment key={column}>{cells[column]}</Fragment>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
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
    </Box>
  )
}
