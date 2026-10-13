import { useMemo, useState } from 'react'
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
import type { CollectionSummary, User } from '../types'
import type { CategoryPathSegment } from './CategoryBreadcrumb'
import { CollectionTypeChip } from './CollectionCard'
import RenewingThumbnail from './RenewingThumbnail'

type SortKey = 'name' | 'type' | 'category' | 'images' | 'owner' | 'updated'

export interface CollectionsTableProps {
  collections: CollectionSummary[]
  /** `buildCategoryPaths` output — resolves the Category breadcrumb cell. */
  categoryPaths: Map<number, CategoryPathSegment>
  currentUser: User | null
  onOpenCollection: (id: number) => void
  /** Cover-token renewal keyed by collection id (same as Manage → Collections). */
  renewCoverThumb?: (id: number) => Promise<{ id: number; thumb: string | null }>
}

/**
 * The Collections page's Table view (#1629): a pared-down Manage →
 * Collections table — cover, name, type, category, images, owner, updated —
 * sortable and paged client-side, with no bulk actions or edit controls.
 * Row click opens the collection.
 */
export default function CollectionsTable({
  collections,
  categoryPaths,
  currentUser,
  onOpenCollection,
  renewCoverThumb,
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

  const sorted = useMemo(() => {
    const rows = [...collections]
    const dir = sortDir === 'asc' ? 1 : -1
    const value = (c: CollectionSummary): string | number => {
      switch (sortKey) {
        case 'name':
          return c.name.toLowerCase()
        case 'type':
          return c.type
        case 'category':
          return categoryLabel(c.categoryId).toLowerCase()
        case 'images':
          return c.imageCount
        case 'owner':
          return describeCollectionOwners(c.owners).toLowerCase()
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
  }, [collections, sortKey, sortDir, categoryPaths])

  // Clamp the stored index: filters/search shrink `collections` without
  // resetting page state, so the slice and TablePagination must agree on
  // one effective page (#1636 review).
  const effectivePage = Math.min(page, Math.max(0, Math.ceil(sorted.length / rowsPerPage) - 1))
  const pageRows = sorted.slice(
    effectivePage * rowsPerPage,
    effectivePage * rowsPerPage + rowsPerPage,
  )

  const headerCell = (key: SortKey, label: string, alignRight = false) => (
    <TableCell
      key={key}
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
            setSortDir(key === 'updated' || key === 'images' ? 'desc' : 'asc')
          }
          setPage(0)
        }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  )

  return (
    <Box data-testid="collections-table">
      <TableContainer>
        <Table size="small" aria-label="Collections">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 56 }}>Cover</TableCell>
              {headerCell('name', 'Name')}
              {headerCell('type', 'Type')}
              {headerCell('category', 'Category')}
              {headerCell('images', 'Images', true)}
              {headerCell('owner', 'Owner')}
              {headerCell('updated', 'Updated')}
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((c) => (
              <TableRow
                key={c.id}
                hover
                data-testid={`collections-table-row-${c.id}`}
                sx={{ cursor: 'pointer' }}
                onClick={() => onOpenCollection(c.id)}
              >
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
                <TableCell>
                  <CollectionTypeChip type={c.type} />
                </TableCell>
                <TableCell>{categoryLabel(c.categoryId)}</TableCell>
                <TableCell align="right">{c.imageCount}</TableCell>
                <TableCell>
                  <Box
                    component="span"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                  >
                    {describeCollectionOwners(c.owners)}
                    {currentUser != null &&
                      c.owners.some((o) => o.kind === 'user' && o.userId === currentUser.id) && (
                        <Chip size="small" label="You" data-testid="collections-table-you-chip" />
                      )}
                  </Box>
                </TableCell>
                <TableCell>
                  <span title={new Date(c.updatedAt).toLocaleString()}>
                    {formatRelativeTime(c.updatedAt)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
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
