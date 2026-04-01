import { useState, useMemo, useCallback } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CategoryIcon from '@mui/icons-material/Folder'
import ImageIcon from '@mui/icons-material/Image'
import PersonIcon from '@mui/icons-material/Person'
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
}

// ── Helpers ────────────────────────────────────────────

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

// ── Tree traversal helpers ─────────────────────────────

function collectCategoryResults(
  cats: Category[],
  query: string,
  path: Category[],
  results: SearchResult[],
  excludeHidden: boolean,
): void {
  for (const cat of cats) {
    if (excludeHidden && cat.status === 'hidden') continue
    const currentPath = [...path, cat]
    const idx = cat.label.toLowerCase().indexOf(query)
    if (idx !== -1) {
      results.push({
        kind: 'category',
        id: cat.id,
        label: cat.label,
        field: 'Name',
        fieldValue: cat.label,
        matchIndex: idx,
        matchLength: query.length,
        payload: { kind: 'category', categoryPath: currentPath },
      })
    }
    collectCategoryResults(cat.children, query, currentPath, results, excludeHidden)
  }
}

function collectImageResults(
  cats: Category[],
  query: string,
  path: Category[],
  results: SearchResult[],
  excludeHidden: boolean,
): void {
  for (const cat of cats) {
    if (excludeHidden && cat.status === 'hidden') continue
    const currentPath = [...path, cat]
    for (const img of cat.images) {
      addImageMatches(img, query, currentPath, results)
    }
    collectImageResults(cat.children, query, currentPath, results, excludeHidden)
  }
}

function addImageMatches(
  img: ImageItem,
  query: string,
  categoryPath: Category[],
  results: SearchResult[],
): void {
  const fields: { field: string; value: string | null | undefined }[] = [
    { field: 'Name', value: img.name },
    { field: 'Copyright', value: img.copyright },
    { field: 'Note', value: img.note },
  ]
  for (let fi = 0; fi < fields.length; fi++) {
    const { field, value } = fields[fi]
    if (!value) continue
    const idx = value.toLowerCase().indexOf(query)
    if (idx !== -1) {
      results.push({
        kind: 'image',
        id: img.id * 1000 + fi,
        label: img.name,
        field,
        fieldValue: value,
        matchIndex: idx,
        matchLength: query.length,
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
}: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [prevOpen, setPrevOpen] = useState(false)

  // Reset query when modal opens (derived state pattern instead of effect)
  if (open && !prevOpen) {
    setQuery('')
  }
  if (open !== prevOpen) {
    setPrevOpen(open)
  }

  const buildResults = useCallback(
    (q: string): SearchResult[] => {
      if (!q) return []
      const lowerQ = q.toLowerCase()
      const results: SearchResult[] = []

      // 1. Categories
      collectCategoryResults(categories, lowerQ, [], results, isStudent)

      // 2. Images within category tree
      collectImageResults(categories, lowerQ, [], results, isStudent)

      // 3. Uncategorized images
      for (const img of uncategorizedImages) {
        addImageMatches(img, lowerQ, [], results)
      }

      // 4. Programs
      for (const prog of programs) {
        const idx = prog.name.toLowerCase().indexOf(lowerQ)
        if (idx !== -1) {
          results.push({
            kind: 'program',
            id: prog.id,
            label: prog.name,
            field: 'Name',
            fieldValue: prog.name,
            matchIndex: idx,
            matchLength: lowerQ.length,
            payload: { kind: 'program', programId: prog.id },
          })
        }
      }

      // 5. Users
      for (const user of users) {
        const userFields: { field: string; value: string }[] = [
          { field: 'Name', value: user.name },
          { field: 'Email', value: user.email },
          { field: 'Role', value: user.role },
        ]
        for (let fi = 0; fi < userFields.length; fi++) {
          const { field, value } = userFields[fi]
          const idx = value.toLowerCase().indexOf(lowerQ)
          if (idx !== -1) {
            results.push({
              kind: 'user',
              id: user.id * 1000 + fi,
              label: user.name,
              field,
              fieldValue: value,
              matchIndex: idx,
              matchLength: lowerQ.length,
              payload: { kind: 'user', userId: user.id },
            })
          }
        }
      }

      return results
    },
    [categories, uncategorizedImages, programs, users, isStudent],
  )

  const results = useMemo(() => buildResults(query), [query, buildResults])

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
            minHeight: '60vh',
            maxHeight: '80vh',
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
          placeholder="Search categories, images, programs, people\u2026"
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

        <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
          {query.trim().length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 200 }}>
              <Typography variant="body1" color="text.secondary">
                Start typing to search&hellip;
              </Typography>
            </Box>
          ) : results.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 200 }}>
              <Typography variant="body1" color="text.secondary">
                No results found for &ldquo;{query}&rdquo;
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {results.length} result{results.length !== 1 ? 's' : ''}
              </Typography>
              {results.map((result, i) => {
                const { before, match, after } = contextSnippet(
                  result.fieldValue,
                  result.matchIndex,
                  result.matchLength,
                )
                return (
                  <Card key={`${result.kind}-${result.id}-${i}`} variant="outlined">
                    <CardActionArea
                      onClick={() => handleSelect(result)}
                      sx={{ p: 2, display: 'flex', alignItems: 'flex-start', gap: 2 }}
                    >
                      <Box sx={{ mt: 0.25 }}>{iconForKind(result.kind)}</Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                          <Typography variant="subtitle2" noWrap>
                            {result.label}
                          </Typography>
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
