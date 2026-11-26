import { Fragment, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import TableRows from '@mui/icons-material/TableRows'
import ViewColumn from '@mui/icons-material/ViewColumn'
import ViewModule from '@mui/icons-material/ViewModule'
import { boardOwnersText, ownsBoard } from '../boardUtils'
import { graphToggleSx } from '../collectionsGraph/toggleStyles'
import { formatRelativeTime } from '../formatUtils'
import type { ApiBoardSummary, ApiMarker, BoardVisibility, User } from '../types'
import { ROWS_PER_PAGE_OPTIONS, useRowsPerPagePreference } from '../useRowsPerPagePreference'
import { useTableColumnPreferences } from '../useTableColumnPreferences'
import BoardCard from './BoardCard'
import { CollectionVisibilityChip } from './CollectionCard'
import ColumnVisibilityDialog, { type ColumnVisibilityOption } from './ColumnVisibilityDialog'
import FilterBar from './FilterBar'
import FilterOptionPanel from './FilterOptionPanel'
import FilterPopoverButton, { filterSurfaceBg } from './FilterPopoverButton'
import FilterTextPanel from './FilterTextPanel'

type BoardColumn = 'name' | 'markers' | 'scope' | 'owners' | 'created' | 'updated'
type Show = 'shared' | 'instructor'

const BOARD_COLUMN_OPTIONS: readonly ColumnVisibilityOption<BoardColumn>[] = [
  { key: 'name', label: 'Name' },
  { key: 'markers', label: 'Markers' },
  { key: 'scope', label: 'Scope' },
  { key: 'owners', label: 'Owners' },
  { key: 'created', label: 'Created' },
  { key: 'updated', label: 'Updated' },
]
const BOARD_ALL_COLUMNS = BOARD_COLUMN_OPTIONS.map((option) => option.key)
const BOARD_DEFAULT_COLUMNS: BoardColumn[] = ['name', 'markers', 'scope', 'owners', 'updated']
const SCOPES: readonly BoardVisibility[] = ['private', 'restricted', 'public']
const SHOW_LABELS: Record<Show, string> = {
  shared: 'Public & Shared',
  instructor: 'Instructor Boards',
}

export interface AllBoardsDialogProps {
  open: boolean
  onClose: () => void
  boards: ApiBoardSummary[]
  /** The user's own recent Markers — a Board matches Favourites if it holds a favourite one. */
  recent: ApiMarker[]
  loading: boolean
  error: string | null
  currentUser: User | null
  onOpenBoard: (boardId: number) => void
}

/**
 * All Boards discovery (#1978): the page's filter bar, Category/Collection
 * style Board cards and a Cards/Table toggle whose table mirrors My Markers
 * (sortable, column chooser, paging). Discovery is UX scoping only — the
 * backend decides which Boards are listed.
 */
export default function AllBoardsDialog({
  open,
  onClose,
  boards,
  recent,
  loading,
  error,
  currentUser,
  onOpenBoard,
}: AllBoardsDialogProps) {
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [query, setQuery] = useState('')
  const [scopes, setScopes] = useState<BoardVisibility[]>([])
  const [owner, setOwner] = useState('any')
  const [favourites, setFavourites] = useState(false)
  const [show, setShow] = useState<Show[]>([])
  const [sortColumn, setSortColumn] = useState<BoardColumn>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useRowsPerPagePreference('all-boards')
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const { visibleColumns, toggleColumn, columnOrder, orderedVisibleColumns, setColumnOrder } =
    useTableColumnPreferences<BoardColumn>({
      tableKey: 'all-boards',
      allColumns: BOARD_ALL_COLUMNS,
      defaultVisibleColumns: BOARD_DEFAULT_COLUMNS,
    })
  const orderedColumnOptions = useMemo(() => {
    const byKey = new Map(BOARD_COLUMN_OPTIONS.map((option) => [option.key, option]))
    return columnOrder
      .map((key) => byKey.get(key))
      .filter((option): option is ColumnVisibilityOption<BoardColumn> => option != null)
  }, [columnOrder])

  const isShared = (row: ApiBoardSummary) =>
    (!ownsBoard(row, currentUser) || !row.permissions.can_edit) &&
    (row.visibility !== 'private' || ownsBoard(row, currentUser))
  const isInstructor = (row: ApiBoardSummary) =>
    row.owner_program_id != null ||
    row.owners.some((o) => o.role === 'admin' || o.role === 'instructor')
  const ownerKey = (o: ApiBoardSummary['owners'][number]) =>
    o.user_id != null ? `user:${o.user_id}` : `program:${o.program_id}`
  const ownerOptions = Array.from(
    new Map(boards.flatMap((row) => row.owners).map((o) => [ownerKey(o), o.name])).entries(),
  ).map(([value, label]) => ({ value, label }))

  const needle = query.trim().toLocaleLowerCase()
  const filtered = !!needle || scopes.length > 0 || owner !== 'any' || favourites || show.length > 0
  const matches = boards.filter(
    (row) =>
      (!show.length ||
        show.some((filter) => (filter === 'shared' ? isShared(row) : isInstructor(row)))) &&
      (!needle || `${row.name} ${row.description ?? ''}`.toLocaleLowerCase().includes(needle)) &&
      (!scopes.length || scopes.includes(row.visibility)) &&
      (owner === 'any' ||
        (owner === 'mine'
          ? ownsBoard(row, currentUser)
          : row.owners.some((o) => ownerKey(o) === owner))) &&
      (!favourites || recent.some((item) => item.favourite && item.board_ids.includes(row.id))),
  )
  const clearFilters = () => {
    setQuery('')
    setScopes([])
    setOwner('any')
    setFavourites(false)
    setShow([])
    setPage(0)
  }
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  const openBoard = (row: ApiBoardSummary) => {
    onClose()
    onOpenBoard(row.id)
  }

  const sortValue = (row: ApiBoardSummary, column: BoardColumn) => {
    switch (column) {
      case 'name':
        return row.name.toLocaleLowerCase()
      case 'markers':
        return row.marker_count
      case 'scope':
        return row.visibility
      case 'owners':
        return (boardOwnersText(row) ?? '').toLocaleLowerCase()
      case 'created':
        return row.created_at
      case 'updated':
        return row.updated_at
    }
  }
  const sorted = [...matches].sort((a, b) => {
    const av = sortValue(a, sortColumn)
    const bv = sortValue(b, sortColumn)
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
    return (sortDirection === 'asc' ? cmp : -cmp) || a.id - b.id
  })
  const maxPage = Math.max(0, Math.ceil(sorted.length / rowsPerPage) - 1)
  const currentPage = Math.min(page, maxPage)
  const pageRows = sorted.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage)
  const sortBy = (column: BoardColumn) => {
    if (sortColumn === column) setSortDirection((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    else {
      setSortColumn(column)
      setSortDirection('asc')
    }
    setPage(0)
  }
  const dateCell = (value: string) => (
    <TableCell>
      <span title={new Date(value).toLocaleString()}>{formatRelativeTime(value)}</span>
    </TableCell>
  )

  const clearButton = (
    <Button size="small" sx={{ whiteSpace: 'nowrap' }} onClick={clearFilters}>
      Clear filters
    </Button>
  )
  const filterChip = (label: string, active: boolean, onClick: () => void) => (
    <Chip
      key={label}
      size="small"
      sx={{ px: 0.5 }}
      label={label}
      variant={active ? 'filled' : 'outlined'}
      color={active ? 'primary' : 'default'}
      aria-pressed={active}
      onClick={onClick}
    />
  )

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="lg"
        aria-labelledby="all-boards-title"
      >
        <DialogTitle
          // An explicit id stops DialogTitle adopting `aria-labelledby`, so the
          // span below — not the toggle's text — names the dialog.
          id="all-boards-title-row"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
        >
          <span id="all-boards-title">All Boards</span>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            aria-label="All Boards view"
            sx={[
              ...(Array.isArray(graphToggleSx) ? graphToggleSx : [graphToggleSx]),
              {
                '& .MuiToggleButton-root': {
                  gap: 0.75,
                  px: 1.25,
                  py: '3px',
                  textTransform: 'none',
                },
                '& .MuiToggleButton-root.Mui-selected': {
                  color: (t) =>
                    t.palette.mode === 'light' ? t.palette.primary.dark : t.palette.primary.light,
                },
              },
            ]}
            onChange={(_, value: 'cards' | 'table' | null) => {
              if (value) setView(value)
            }}
          >
            <ToggleButton value="cards" aria-label="Cards view">
              <ViewModule fontSize="small" /> Cards
            </ToggleButton>
            <ToggleButton value="table" aria-label="Table view">
              <TableRows fontSize="small" /> Table
            </ToggleButton>
          </ToggleButtonGroup>
        </DialogTitle>
        <Box sx={{ px: 3 }}>
          <FilterBar
            ariaLabel="Filter All Boards"
            // The extra Show: filters don't fit one row in the dialog.
            wrap
            actions={
              // Kept in every view so the bar's height doesn't jump (BoardsPage convention).
              <Button
                size="small"
                startIcon={<ViewColumn fontSize="small" />}
                aria-hidden={view !== 'table'}
                tabIndex={view === 'table' ? undefined : -1}
                // nowrap: the wrapping filters would otherwise squeeze it onto two lines.
                sx={{ whiteSpace: 'nowrap', ...(view !== 'table' && { visibility: 'hidden' }) }}
                onClick={() => setColumnDialogOpen(true)}
              >
                Choose columns
              </Button>
            }
            summary={
              filtered ? (
                // Clear filters sits right after the chips it clears; the wrapped
                // filter row is too wide to keep it beside the controls.
                <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
                  {query && (
                    <Chip size="small" label={`Title: ${query}`} onDelete={() => setQuery('')} />
                  )}
                  {scopes.map((scope) => (
                    <Chip
                      key={scope}
                      size="small"
                      label={scope[0].toUpperCase() + scope.slice(1)}
                      onDelete={() => setScopes(scopes.filter((s) => s !== scope))}
                    />
                  ))}
                  {owner !== 'any' && (
                    <Chip
                      size="small"
                      label={
                        owner === 'mine'
                          ? 'Mine'
                          : ownerOptions.find((o) => o.value === owner)?.label
                      }
                      onDelete={() => setOwner('any')}
                    />
                  )}
                  {favourites && (
                    <Chip size="small" label="Favourites" onDelete={() => setFavourites(false)} />
                  )}
                  {show.map((value) => (
                    <Chip
                      key={value}
                      size="small"
                      label={SHOW_LABELS[value]}
                      onDelete={() => setShow(show.filter((s) => s !== value))}
                    />
                  ))}
                  {clearButton}
                </Stack>
              ) : undefined
            }
          >
            <FilterPopoverButton
              label="Title"
              activeCount={query ? 1 : 0}
              sx={{ color: 'text.primary' }}
            >
              <FilterTextPanel
                value={query}
                onChange={setQuery}
                placeholder="Filter by title or description"
                ariaLabel="Filter All Boards by title"
              />
            </FilterPopoverButton>
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                Scope:
              </Typography>
              {SCOPES.map((value) =>
                filterChip(value[0].toUpperCase() + value.slice(1), scopes.includes(value), () =>
                  setScopes((current) => toggle(current, value)),
                ),
              )}
            </Box>
            <FilterPopoverButton
              label="Owner"
              activeCount={owner === 'any' ? 0 : 1}
              sx={{ color: 'text.primary' }}
            >
              <FilterOptionPanel
                multiple={false}
                options={[
                  { value: 'any', label: 'Anyone' },
                  { value: 'mine', label: 'Mine' },
                  ...ownerOptions,
                ]}
                selectedValues={[owner]}
                onChange={(values) => setOwner(values[0] ?? 'any')}
              />
            </FilterPopoverButton>
            {filterChip('Favourites', favourites, () => setFavourites(!favourites))}
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                Show:
              </Typography>
              {(['shared', 'instructor'] as const).map((value) =>
                filterChip(SHOW_LABELS[value], show.includes(value), () =>
                  setShow((current) => toggle(current, value)),
                ),
              )}
            </Box>
          </FilterBar>
        </Box>
        <DialogContent sx={{ pt: 2 }}>
          {loading ? (
            <CircularProgress aria-label="Loading all Boards" size={24} />
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : !sorted.length ? (
            <Typography color="text.secondary">
              {filtered ? 'No matching Boards.' : 'No Boards available.'}
            </Typography>
          ) : view === 'cards' ? (
            // Category/Collection-style cards at the Collections grid's 300px (#1978).
            <Box data-testid="all-boards-grid" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {matches.map((row) => (
                <Box key={row.id} sx={{ width: 300, maxWidth: '100%' }}>
                  <BoardCard board={row} onOpen={openBoard} />
                </Box>
              ))}
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label="All Boards">
                <TableHead
                  sx={{
                    '& .MuiTableCell-head': { bgcolor: (t) => filterSurfaceBg(t), fontWeight: 600 },
                  }}
                >
                  <TableRow>
                    {orderedVisibleColumns.map((column) => (
                      <TableCell
                        key={column}
                        sortDirection={sortColumn === column ? sortDirection : false}
                      >
                        <TableSortLabel
                          active={sortColumn === column}
                          direction={sortColumn === column ? sortDirection : 'asc'}
                          onClick={() => sortBy(column)}
                        >
                          {BOARD_COLUMN_OPTIONS.find((option) => option.key === column)?.label}
                        </TableSortLabel>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageRows.map((row) => {
                    const cells: Record<BoardColumn, ReactNode> = {
                      name: (
                        <TableCell>
                          <Link
                            component="button"
                            type="button"
                            underline="hover"
                            aria-label={`Open Board: ${row.name}`}
                            onClick={() => openBoard(row)}
                            sx={{ textAlign: 'left', overflowWrap: 'anywhere' }}
                          >
                            {row.name}
                          </Link>
                        </TableCell>
                      ),
                      markers: <TableCell>{row.marker_count}</TableCell>,
                      scope: (
                        <TableCell>
                          <CollectionVisibilityChip visibility={row.visibility} />
                        </TableCell>
                      ),
                      owners: <TableCell>{boardOwnersText(row) ?? 'No owner'}</TableCell>,
                      created: dateCell(row.created_at),
                      updated: dateCell(row.updated_at),
                    }
                    return (
                      <TableRow key={row.id} hover>
                        {orderedVisibleColumns.map((column) => (
                          <Fragment key={column}>{cells[column]}</Fragment>
                        ))}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <TablePagination
                component="div"
                count={sorted.length}
                page={currentPage}
                rowsPerPage={rowsPerPage}
                rowsPerPageOptions={[...ROWS_PER_PAGE_OPTIONS]}
                onPageChange={(_, next) => setPage(next)}
                onRowsPerPageChange={(event) => {
                  setRowsPerPage(parseInt(event.target.value, 10))
                  setPage(0)
                }}
              />
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
      <ColumnVisibilityDialog
        open={columnDialogOpen}
        title="Choose columns"
        columns={orderedColumnOptions}
        visibleColumns={visibleColumns}
        onClose={() => setColumnDialogOpen(false)}
        onToggleColumn={toggleColumn}
        onReorderColumns={setColumnOrder}
      />
    </>
  )
}
