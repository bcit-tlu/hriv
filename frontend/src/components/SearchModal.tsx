import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CategoryIcon from '@mui/icons-material/Folder'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CopyrightIcon from '@mui/icons-material/Copyright'
import ImageIcon from '@mui/icons-material/Image'
import NoteIcon from '@mui/icons-material/StickyNote2'
import PersonIcon from '@mui/icons-material/Person'
import BadgeIcon from '@mui/icons-material/Badge'
import SchoolIcon from '@mui/icons-material/School'
import SearchIcon from '@mui/icons-material/Search'
import type { Category, ImageItem, Program } from '../types'
import type { ApiUser } from '../api'

// ── Result types ───────────────────────────────────────

type ResultKind = 'category' | 'image' | 'program' | 'user'

interface SearchResult {
  kind: ResultKind
  id: number
  /** Primary label shown in bold */
  label: string
  /** Which field matched */
  field: string
  /** The raw field value that matched */
  fieldValue: string
  /** Index of the match start within fieldValue (for highlighting) */
  matchIndex: number
  /** Length of the matched query string */
  matchLength: number
  /** Extra payload needed for navigation */
  payload: CategoryPayload | ImagePayload | ProgramPayload | UserPayload
}

interface CategoryPayload {
  kind: 'category'
  categoryPath: Category[]
}

interface ImagePayload {
  kind: 'image'
  image: ImageItem
  categoryPath: Category[]
}

interface ProgramPayload {
  kind: 'program'
  programId: number
}

interface UserPayload {
  kind: 'user'
  userId: number
  programNames: string[]
}

// ── Filter definitions ─────────────────────────────────

export type TypeFilter = ResultKind
type FieldFilter = 'Copyright' | 'Note' | 'Role'

interface FilterDef<T extends string> {
  key: T
  label: string
  icon: React.ReactElement
  tooltip: string
}

const TYPE_FILTERS: FilterDef<TypeFilter>[] = [
  { key: 'category', label: 'Categories', icon: <CategoryIcon fontSize="small" />, tooltip: 'Show only categories' },
  { key: 'image', label: 'Images', icon: <ImageIcon fontSize="small" />, tooltip: 'Show only images' },
  { key: 'program', label: 'Programs', icon: <SchoolIcon fontSize="small" />, tooltip: 'Show only programs' },
  { key: 'user', label: 'People', icon: <PersonIcon fontSize="small" />, tooltip: 'Show only people' },
]

const FIELD_FILTERS: FilterDef<FieldFilter>[] = [
  { key: 'Copyright', label: 'Copyright', icon: <CopyrightIcon fontSize="small" />, tooltip: 'Copyright field only' },
  { key: 'Note', label: 'Note', icon: <NoteIcon fontSize="small" />, tooltip: 'Note field only' },
  { key: 'Role', label: 'Role', icon: <BadgeIcon fontSize="small" />, tooltip: 'Role field only' },
]

// ── Constants ──────────────────────────────────────────

const MAX_RESULTS = 50
const CONTEXT_CHARS = 40

function contextSnippet(
  value: string,
  matchIndex: number,
  matchLength: number,
): { before: string; match: string; after: string } {
  const start = Math.max(0, matchIndex - CONTEXT_CHARS)
  const end = Math.min(value.length, matchIndex + matchLength + CONTEXT_CHARS)
  const before = (start > 0 ? '\u2026' : '') + value.slice(start, matchIndex)
  const match = value.slice(matchIndex, matchIndex + matchLength)
  const after = value.slice(matchIndex + matchLength, end) + (end < value.length ? '\u2026' : '')
  return { before, match, after }
}

function iconForKind(kind: ResultKind) {
  switch (kind) {
    case 'category':
      return <CategoryIcon color="primary" />
    case 'image':
      return <ImageIcon color="secondary" />
    case 'program':
      return <SchoolIcon sx={{ color: '#6a8a5b' }} />
    case 'user':
      return <PersonIcon sx={{ color: '#5b7a8a' }} />
  }
}

function labelForKind(kind: ResultKind): string {
  switch (kind) {
    case 'category':
      return 'Category'
    case 'image':
      return 'Image'
    case 'program':
      return 'Program'
    case 'user':
      return 'User'
  }
}

/** Find the first match of any term in `terms` within `text` (case-insensitive). */
function findFirstTermMatch(
  text: string,
  terms: string[],
): { index: number; length: number } | null {
  const lower = text.toLowerCase()
  let best: { index: number; length: number } | null = null
  for (const term of terms) {
    const idx = lower.indexOf(term)
    if (idx !== -1 && (best === null || idx < best.index)) {
      best = { index: idx, length: term.length }
    }
  }
  return best
}

/** Resolve program names for a search result (categories, images, users). */
function getResultProgramNames(
  result: SearchResult,
  programMap: Map<number, string>,
): string[] {
  const { payload } = result
  switch (payload.kind) {
    case 'category': {
      const cat = payload.categoryPath[payload.categoryPath.length - 1]
      return cat?.programIds
        .map((pid) => programMap.get(pid))
        .filter((n): n is string => n != null) ?? []
    }
    case 'image': {
      const parentCat = payload.categoryPath[payload.categoryPath.length - 1]
      return parentCat?.programIds
        .map((pid) => programMap.get(pid))
        .filter((n): n is string => n != null) ?? []
    }
    case 'user':
      return payload.programNames
    default:
      return []
  }
}

// ── Tree traversal helpers ─────────────────────────────

function collectCategoryResults(
  cats: Category[],
  terms: string[],
  path: Category[],
  results: SearchResult[],
  excludeHidden: boolean,
  programMap: Map<number, string>,
): void {
  for (const cat of cats) {
    if (excludeHidden && cat.status === 'hidden') continue
    const currentPath = [...path, cat]
    const m = findFirstTermMatch(cat.label, terms)
    if (m) {
      results.push({
        kind: 'category',
        id: cat.id,
        label: cat.label,
        field: 'Name',
        fieldValue: cat.label,
        matchIndex: m.index,
        matchLength: m.length,
        payload: { kind: 'category', categoryPath: currentPath },
      })
    }
    for (const pid of cat.programIds) {
      const pName = programMap.get(pid)
      if (!pName) continue
      const pm = findFirstTermMatch(pName, terms)
      if (pm) {
        results.push({
          kind: 'category',
          id: cat.id * 1000 + pid,
          label: cat.label,
          field: 'Program',
          fieldValue: pName,
          matchIndex: pm.index,
          matchLength: pm.length,
          payload: { kind: 'category', categoryPath: currentPath },
        })
        break
      }
    }
    collectCategoryResults(cat.children, terms, currentPath, results, excludeHidden, programMap)
  }
}

function collectImageResults(
  cats: Category[],
  terms: string[],
  path: Category[],
  results: SearchResult[],
  excludeHidden: boolean,
  programMap: Map<number, string>,
): void {
  for (const cat of cats) {
    if (excludeHidden && cat.status === 'hidden') continue
    const currentPath = [...path, cat]
    for (const img of cat.images) {
      addImageMatches(img, terms, currentPath, results, programMap)
    }
    collectImageResults(cat.children, terms, currentPath, results, excludeHidden, programMap)
  }
}

function addImageMatches(
  img: ImageItem,
  terms: string[],
  categoryPath: Category[],
  results: SearchResult[],
  programMap: Map<number, string>,
): void {
  const parentCat = categoryPath.length > 0 ? categoryPath[categoryPath.length - 1] : null
  const fields: { field: string; value: string | null | undefined }[] = [
    { field: 'Name', value: img.name },
    { field: 'Copyright', value: img.copyright },
    { field: 'Note', value: img.note },
  ]
  if (parentCat) {
    fields.push({ field: 'Category', value: parentCat.label })
    for (const pid of parentCat.programIds) {
      const pName = programMap.get(pid)
      if (pName) fields.push({ field: 'Program', value: pName })
    }
  }
  for (let fi = 0; fi < fields.length; fi++) {
    const { field, value } = fields[fi]
    if (!value) continue
    const m = findFirstTermMatch(value, terms)
    if (m) {
      results.push({
        kind: 'image',
        id: img.id * 1000 + fi,
        label: img.name,
        field,
        fieldValue: value,
        matchIndex: m.index,
        matchLength: m.length,
        payload: { kind: 'image', image: img, categoryPath },
      })
    }
  }
}

// ── Component ──────────────────────────────────────────

interface SearchModalProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  uncategorizedImages: ImageItem[]
  programs: Program[]
  users: ApiUser[]
  isStudent: boolean
  onSelectCategory: (path: Category[]) => void
  onSelectImage: (image: ImageItem, path: Category[]) => void
  onSelectProgram: () => void
  onSelectUser: () => void
  /** Pre-fill the search query when the modal opens. */
  initialQuery?: string
  /** Pre-select a type filter when the modal opens. */
  initialTypeFilter?: TypeFilter
}

export default function SearchModal({
  open,
  onClose,
  categories,
  uncategorizedImages,
  programs,
  users,
  isStudent,
  onSelectCategory,
  onSelectImage,
  onSelectProgram,
  onSelectUser,
  initialQuery,
  initialTypeFilter,
}: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [typeFilters, setTypeFilters] = useState<Set<TypeFilter>>(new Set())
  const [fieldFilters, setFieldFilters] = useState<Set<FieldFilter>>(new Set())

  const programMap = useMemo(() => new Map(programs.map((p) => [p.id, p.name])), [programs])

  // Apply initial values when the modal opens with them
  const prevOpenRef = useRef(false)
  const wasSeededRef = useRef(false)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      if (initialQuery != null || initialTypeFilter != null) {
        if (initialQuery != null) setQuery(initialQuery)
        if (initialTypeFilter != null) setTypeFilters(new Set([initialTypeFilter]))
        setFieldFilters(new Set())
        wasSeededRef.current = true
      }
    }
    if (!open && prevOpenRef.current && wasSeededRef.current) {
      setQuery('')
      setTypeFilters(new Set())
      setFieldFilters(new Set())
      wasSeededRef.current = false
    }
    prevOpenRef.current = open
  }, [open, initialQuery, initialTypeFilter])

  const toggleTypeFilter = useCallback((key: TypeFilter) => {
    setTypeFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const toggleFieldFilter = useCallback((key: FieldFilter) => {
    setFieldFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const buildResults = useCallback(
    (q: string): SearchResult[] => {
      if (!q.trim()) return []
      // Split query into individual terms (union search)
      const terms = q
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0)
      if (terms.length === 0) return []
      const results: SearchResult[] = []

      // 1. Categories
      collectCategoryResults(categories, terms, [], results, isStudent, programMap)

      // 2. Images within category tree
      collectImageResults(categories, terms, [], results, isStudent, programMap)

      // 3. Uncategorized images
      for (const img of uncategorizedImages) {
        addImageMatches(img, terms, [], results, programMap)
      }

      // 4. Programs (hidden from students)
      if (!isStudent) {
        for (const prog of programs) {
          const m = findFirstTermMatch(prog.name, terms)
          if (m) {
            results.push({
              kind: 'program',
              id: prog.id,
              label: prog.name,
              field: 'Name',
              fieldValue: prog.name,
              matchIndex: m.index,
              matchLength: m.length,
              payload: { kind: 'program', programId: prog.id },
            })
          }
        }
      }

      // 5. Users
      for (const user of users) {
        const userFields: { field: string; value: string }[] = [
          { field: 'Name', value: user.name },
          { field: 'Email', value: user.email },
          { field: 'Role', value: user.role },
        ]
        for (const pName of user.program_names ?? []) {
          userFields.push({ field: 'Program', value: pName })
        }
        for (let fi = 0; fi < userFields.length; fi++) {
          const { field, value } = userFields[fi]
          const m = findFirstTermMatch(value, terms)
          if (m) {
            results.push({
              kind: 'user',
              id: user.id * 1000 + fi,
              label: user.name,
              field,
              fieldValue: value,
              matchIndex: m.index,
              matchLength: m.length,
              payload: { kind: 'user', userId: user.id, programNames: user.program_names ?? [] },
            })
          }
        }
      }

      return results
    },
    [categories, uncategorizedImages, programs, users, isStudent, programMap],
  )

  const allResults = useMemo(() => buildResults(query), [query, buildResults])

  // Apply type and field filters, then cap at MAX_RESULTS
  const filteredResults = useMemo(() => {
    let filtered = allResults
    if (typeFilters.size > 0) {
      filtered = filtered.filter((r) => typeFilters.has(r.kind))
    }
    if (fieldFilters.size > 0) {
      filtered = filtered.filter((r) => fieldFilters.has(r.field as FieldFilter))
    }
    return filtered
  }, [allResults, typeFilters, fieldFilters])

  const displayResults = useMemo(
    () => filteredResults.slice(0, MAX_RESULTS),
    [filteredResults],
  )

  const handleSelect = (result: SearchResult) => {
    onClose()
    switch (result.payload.kind) {
      case 'category':
        onSelectCategory(result.payload.categoryPath)
        break
      case 'image':
        onSelectImage(result.payload.image, result.payload.categoryPath)
        break
      case 'program':
        onSelectProgram()
        break
      case 'user':
        onSelectUser()
        break
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            height: '80vh',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', p: 3, gap: 2 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Search categories, images, programs, people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            },
          }}
        />

        {/* Filter chips */}
        {query.trim().length > 0 && allResults.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 0.5 }}>
              Type:
            </Typography>
            {TYPE_FILTERS.filter((f) => !(isStudent && f.key === 'program')).map((f) => (
              <Tooltip key={f.key} title={f.tooltip}>
                <Chip
                  icon={f.icon}
                  label={f.label}
                  size="small"
                  sx={{ px: 0.5 }}
                  variant={typeFilters.has(f.key) ? 'filled' : 'outlined'}
                  color={typeFilters.has(f.key) ? 'primary' : 'default'}
                  onClick={() => toggleTypeFilter(f.key)}
                />
              </Tooltip>
            ))}
            <Box sx={{ mx: 0.5, borderLeft: 1, borderColor: 'divider' }} />
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 0.5 }}>
              Field:
            </Typography>
            {FIELD_FILTERS.map((f) => (
              <Tooltip key={f.key} title={f.tooltip}>
                <Chip
                  icon={f.icon}
                  label={f.label}
                  size="small"
                  sx={{ px: 0.5 }}
                  variant={fieldFilters.has(f.key) ? 'filled' : 'outlined'}
                  color={fieldFilters.has(f.key) ? 'primary' : 'default'}
                  onClick={() => toggleFieldFilter(f.key)}
                />
              </Tooltip>
            ))}
          </Box>
        )}

        <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
          {query.trim().length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 200 }}>
              <Typography variant="body1" color="text.secondary">
                Start typing to search&hellip;
              </Typography>
            </Box>
          ) : filteredResults.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 200 }}>
              <Typography variant="body1" color="text.secondary">
                No results found for &ldquo;{query}&rdquo;
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {filteredResults.length > MAX_RESULTS
                  ? `Showing ${MAX_RESULTS} of ${filteredResults.length} results`
                  : `${filteredResults.length} result${filteredResults.length !== 1 ? 's' : ''}`}
              </Typography>
              {displayResults.map((result, i) => {
                const { before, match, after } = contextSnippet(
                  result.fieldValue,
                  result.matchIndex,
                  result.matchLength,
                )
                const chipNames = getResultProgramNames(result, programMap)
                const catPath = result.payload.kind === 'image' ? result.payload.categoryPath : null
                const thumb = result.payload.kind === 'image' ? result.payload.image.thumb : null
                return (
                  <Card key={`${result.kind}-${result.id}-${i}`} variant="outlined">
                    <CardActionArea
                      onClick={() => handleSelect(result)}
                      sx={{ p: 2, display: 'flex', alignItems: 'flex-start', gap: 2 }}
                    >
                      {thumb ? (
                        <Box
                          component="img"
                          src={thumb}
                          alt={result.label}
                          sx={{
                            width: 40,
                            height: 40,
                            objectFit: 'cover',
                            borderRadius: 0.5,
                            flexShrink: 0,
                          }}
                        />
                      ) : result.kind !== 'program' ? (
                        <Box sx={{ mt: 0.25 }}>{iconForKind(result.kind)}</Box>
                      ) : null}
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25, flexWrap: 'wrap' }}>
                          {result.kind === 'program' ? (
                            <Chip label={result.label} size="small" />
                          ) : (
                            <Typography variant="subtitle2" noWrap>
                              {result.label}
                            </Typography>
                          )}
                          <Typography
                            variant="caption"
                            sx={{
                              px: 1,
                              py: 0.25,
                              borderRadius: 1,
                              bgcolor: 'action.hover',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {labelForKind(result.kind)}
                          </Typography>
                          {!isStudent && chipNames.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              {chipNames.map((name) => (
                                <Chip key={name} label={name} size="small" color="primary" />
                              ))}
                            </Box>
                          )}
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                          <Typography variant="caption" color="text.disabled" component="span">
                            {result.field}:{' '}
                          </Typography>
                          {before}
                          <Box
                            component="span"
                            sx={{ bgcolor: 'warning.light', color: 'warning.contrastText', borderRadius: 0.5, px: 0.25 }}
                          >
                            {match}
                          </Box>
                          {after}
                        </Typography>
                        {catPath && catPath.length > 0 && (
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
                            <CategoryIcon sx={{ fontSize: 14, color: 'text.disabled', mr: 0.5 }} />
                            {catPath.map((cat, ci) => (
                              <Box component="span" key={cat.id} sx={{ display: 'inline-flex', alignItems: 'center' }}>
                                {ci > 0 && <ChevronRightIcon sx={{ fontSize: 14, color: 'text.disabled', mx: 0.25 }} />}
                                <Typography variant="caption" color="text.secondary">
                                  {cat.label}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        )}
                      </Box>
                    </CardActionArea>
                  </Card>
                )
              })}
            </Box>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  )
}
