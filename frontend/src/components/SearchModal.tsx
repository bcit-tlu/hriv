import { useState, useMemo, useCallback, useRef } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CategoryIcon from '@mui/icons-material/Folder'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CollectionsIcon from '@mui/icons-material/Collections'
import CopyrightIcon from '@mui/icons-material/Copyright'
import ImageIcon from '@mui/icons-material/Image'
import LinkIcon from '@mui/icons-material/Link'
import NoteIcon from '@mui/icons-material/StickyNote2'
import PersonIcon from '@mui/icons-material/Person'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import BadgeIcon from '@mui/icons-material/Badge'
import SchoolIcon from '@mui/icons-material/School'
import SearchIcon from '@mui/icons-material/Search'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import type { Category, CollectionSummary, ImageItem, Program } from '../types'
import type { ApiImage, ApiUser } from '../api'
import { describeCollectionOwners } from '../collectionUtils'
import { buildGuideIndex, type GuideSearchSection } from '../guideSearch'
import { parseSearchQuery } from '../searchQuery'
import RenewingThumbnail from './RenewingThumbnail'

// ── Result types ───────────────────────────────────────

type ResultKind = 'category' | 'image' | 'program' | 'user' | 'guide' | 'collection'

interface FieldMatch {
  field: string
  fieldValue: string
  matchIndex: number
  matchLength: number
}

interface SearchResult {
  kind: ResultKind
  /** Real entity identifier for deduplication (e.g. cat.id, img.id, user.id);
      guide results use a `<slug>#<anchor>` string key. */
  entityId: number | string
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
  payload:
    CategoryPayload | ImagePayload | ProgramPayload | UserPayload | GuidePayload | CollectionPayload
}

interface GroupedResult {
  kind: ResultKind
  entityId: number | string
  label: string
  matches: FieldMatch[]
  payload:
    CategoryPayload | ImagePayload | ProgramPayload | UserPayload | GuidePayload | CollectionPayload
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

interface GuidePayload {
  kind: 'guide'
  slug: string
  anchor?: string
}

interface CollectionPayload {
  kind: 'collection'
  collection: CollectionSummary
}

// ── Filter definitions ─────────────────────────────────

export type TypeFilter = ResultKind
type FieldFilter = 'Annotation' | 'Link' | 'Link URL' | 'Copyright' | 'Note' | 'Role'

interface FilterDef<T extends string> {
  key: T
  label: string
  icon: React.ReactElement
  tooltip: string
}

const TYPE_FILTERS: FilterDef<TypeFilter>[] = [
  {
    key: 'category',
    label: 'Categories',
    icon: <CategoryIcon fontSize="small" />,
    tooltip: 'Search only category names',
  },
  {
    key: 'image',
    label: 'Images',
    icon: <ImageIcon fontSize="small" />,
    tooltip: 'Search only image titles',
  },
  {
    key: 'program',
    label: 'Programs',
    icon: <SchoolIcon fontSize="small" />,
    tooltip: 'Search only program names',
  },
  {
    key: 'user',
    label: 'People',
    icon: <PersonIcon fontSize="small" />,
    tooltip: 'Search only people names',
  },
  {
    key: 'guide',
    label: 'Guide',
    icon: <MenuBookIcon fontSize="small" />,
    tooltip: 'Search only guide titles',
  },
  {
    key: 'collection',
    label: 'Collections',
    icon: <CollectionsIcon fontSize="small" />,
    tooltip: 'Search only collection names and descriptions',
  },
]

/** Fields searched when a type chip is active and no Field chips are selected —
 *  each type searches only the fields most closely associated with it
 *  (e.g. Images searches image titles, Collections searches name + description). */
const PRIMARY_FIELDS_BY_KIND: Record<ResultKind, readonly string[]> = {
  category: ['Name'],
  image: ['Name'],
  program: ['Name'],
  user: ['Name'],
  guide: ['Title'],
  collection: ['Name', 'Description'],
}

const FIELD_FILTERS: FilterDef<FieldFilter>[] = [
  {
    key: 'Annotation',
    label: 'Annotation',
    icon: <TextFieldsIcon fontSize="small" />,
    tooltip: 'Text annotations only',
  },
  { key: 'Link', label: 'Link', icon: <LinkIcon fontSize="small" />, tooltip: 'Link text only' },
  {
    key: 'Link URL',
    label: 'Link URL',
    icon: <LinkIcon fontSize="small" />,
    tooltip: 'Link URLs only',
  },
  {
    key: 'Copyright',
    label: 'Copyright',
    icon: <CopyrightIcon fontSize="small" />,
    tooltip: 'Copyright field only',
  },
  { key: 'Note', label: 'Note', icon: <NoteIcon fontSize="small" />, tooltip: 'Note field only' },
  { key: 'Role', label: 'Role', icon: <BadgeIcon fontSize="small" />, tooltip: 'Role field only' },
]

// ── Constants ──────────────────────────────────────────

const MAX_RESULTS = 50
const CONTEXT_CHARS = 40

function getAnnotationSearchFields(
  metadataExtra: Record<string, unknown> | null | undefined,
): Array<{ field: string; value: string }> {
  const annotations = metadataExtra?.canvas_annotations
  if (!Array.isArray(annotations)) return []

  const fields: Array<{ field: string; value: string }> = []
  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== 'object') continue
    const candidate = annotation as Record<string, unknown>
    const type = candidate.type
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : ''
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''

    if (type === 'text') {
      if (text) fields.push({ field: 'Annotation', value: text })
      continue
    }

    if (type !== 'link') continue
    if (text) fields.push({ field: 'Link', value: text })
    if (url) fields.push({ field: 'Link URL', value: url })
  }

  return fields
}

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
    case 'guide':
      return <MenuBookIcon sx={{ color: '#8a6a5b' }} />
    case 'collection':
      return <CollectionsIcon sx={{ color: '#7a5b8a' }} />
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
    case 'guide':
      return 'Guide'
    case 'collection':
      return 'Collection'
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
  result: SearchResult | GroupedResult,
  programMap: Map<number, string>,
): string[] {
  const { payload } = result
  switch (payload.kind) {
    case 'category': {
      const cat = payload.categoryPath[payload.categoryPath.length - 1]
      return (
        cat?.programIds.map((pid) => programMap.get(pid)).filter((n): n is string => n != null) ??
        []
      )
    }
    case 'image': {
      const parentCat = payload.categoryPath[payload.categoryPath.length - 1]
      return (
        parentCat?.programIds
          .map((pid) => programMap.get(pid))
          .filter((n): n is string => n != null) ?? []
      )
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
        entityId: cat.id,
        label: cat.label,
        field: 'Name',
        fieldValue: cat.label,
        matchIndex: m.index,
        matchLength: m.length,
        payload: { kind: 'category', categoryPath: currentPath },
      })
    }
    for (let pi = 0; pi < cat.programIds.length; pi++) {
      const pName = programMap.get(cat.programIds[pi])
      if (!pName) continue
      const pm = findFirstTermMatch(pName, terms)
      if (pm) {
        results.push({
          kind: 'category',
          entityId: cat.id,
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

/**
 * Every image under a category subtree in registration order (#1567): the
 * category's own images by `sortOrder`, then each child subtree in tree
 * order. Mirrors `collectImageResults`' `excludeHidden` rule — hidden
 * subtrees are skipped entirely.
 */
function collectSubtreeImages(cat: Category, excludeHidden: boolean): ImageItem[] {
  const own = [...cat.images].sort((a, b) => a.sortOrder - b.sortOrder)
  const nested = [...cat.children]
    .filter((child) => !(excludeHidden && child.status === 'hidden'))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((child) => collectSubtreeImages(child, excludeHidden))
  return [...own, ...nested]
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
    ...getAnnotationSearchFields(img.metadataExtra),
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
        entityId: img.id,
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

// Static index — guide Markdown is bundled at build time, so this never
// changes at runtime.
const GUIDE_INDEX: GuideSearchSection[] = buildGuideIndex()

function collectGuideResults(terms: string[], results: SearchResult[]): void {
  for (const section of GUIDE_INDEX) {
    const entityId = section.anchor ? `${section.slug}#${section.anchor}` : section.slug
    const label = section.heading ? `${section.title} — ${section.heading}` : section.title
    const fields = [
      { field: 'Title', value: label },
      { field: 'Content', value: section.content },
    ]
    for (const { field, value } of fields) {
      if (!value) continue
      const m = findFirstTermMatch(value, terms)
      if (m) {
        results.push({
          kind: 'guide',
          entityId,
          label,
          field,
          fieldValue: value,
          matchIndex: m.index,
          matchLength: m.length,
          payload: { kind: 'guide', slug: section.slug, anchor: section.anchor },
        })
      }
    }
  }
}

function collectCollectionResults(
  collections: CollectionSummary[],
  terms: string[],
  results: SearchResult[],
): void {
  for (const collection of collections) {
    const fields: { field: string; value: string | null | undefined }[] = [
      { field: 'Name', value: collection.name },
      { field: 'Description', value: collection.description },
    ]
    for (const { field, value } of fields) {
      if (!value) continue
      const m = findFirstTermMatch(value, terms)
      if (m) {
        results.push({
          kind: 'collection',
          entityId: collection.id,
          label: collection.name,
          field,
          fieldValue: value,
          matchIndex: m.index,
          matchLength: m.length,
          payload: { kind: 'collection', collection },
        })
      }
    }
  }
}

interface SearchModalProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  uncategorizedImages: ImageItem[]
  programs: Program[]
  users: ApiUser[]
  /** The caller's visible collections — the backend list is already
   *  access-filtered, so every row here may surface in results. */
  collections?: CollectionSummary[]
  /** Whether the collections feature is enabled — gates the Collections
   *  chip, collection results, and the placeholder copy. */
  collectionsEnabled?: boolean
  /** Hide categories/images with a non-published status (students only). */
  excludeHidden: boolean
  /** Restrict results to categories/images — no program, user, or guide
   *  result kinds and no related filters (students and staff). */
  suppressExtendedResults: boolean
  onSelectCategory: (path: Category[]) => void
  onSelectImage: (image: ImageItem, path: Category[]) => void
  onImageRenewed?: (image: ApiImage) => void
  onSelectProgram: (programName: string) => void
  onSelectUser: (userId: number) => void
  onSelectGuide?: (slug: string, anchor?: string) => void
  /** Navigate to a collection result (`?collection={id}`). */
  onSelectCollection?: (collectionId: number) => void
  /**
   * Emits the picked images in selection (epoch/result) order when the
   * footer's Add-to-collection action fires. The select layer only exists
   * in picker mode — see `initialSelectMode` (#1567).
   */
  onAddImagesToCollection?: (images: ImageItem[]) => void
  /** Pre-fill the search query when the modal opens. */
  initialQuery?: string
  /** Pre-select a type filter when the modal opens. */
  initialTypeFilter?: TypeFilter
  /** Launch as a collection-image picker (#1567): checkboxes and the
   *  selection footer are on from open and there is no way to leave picker
   *  mode except Cancel/close — the Manage Collection dialog's Add flow
   *  stages picks (including whole categories) straight into its draft.
   *  Requires `onAddImagesToCollection`; without it the modal behaves like
   *  a normal search. */
  initialSelectMode?: boolean
}

export default function SearchModal({
  open,
  onClose,
  categories,
  uncategorizedImages,
  programs,
  users,
  collections = [],
  collectionsEnabled = false,
  excludeHidden,
  suppressExtendedResults,
  onSelectCategory,
  onSelectImage,
  onImageRenewed,
  onSelectProgram,
  onSelectUser,
  onSelectGuide,
  onSelectCollection,
  onAddImagesToCollection,
  initialQuery,
  initialTypeFilter,
  initialSelectMode = false,
}: SearchModalProps) {
  // Multi-select (#1418/#1567): image and category results get checkboxes
  // feeding a sticky footer action — but ONLY when the modal was launched
  // as a collection-image picker (`initialSelectMode`, currently the
  // Manage-collection dialog's Add flow). The normal search never shows
  // the select layer.
  const selectMode = initialSelectMode && onAddImagesToCollection != null
  const [query, setQuery] = useState('')
  // The picker pre-applies the Categories + Images type chips (#1567) —
  // only addable kinds list by default; the chips stay toggleable.
  const [typeFilters, setTypeFilters] = useState<Set<TypeFilter>>(
    () => new Set(selectMode ? ['category', 'image'] : []),
  )
  const [fieldFilters, setFieldFilters] = useState<Set<FieldFilter>>(new Set())
  // The image rides along in each entry so picks survive a query change —
  // the collection-add callback emits `ImageItem`s (#1567), which a stale
  // result list could no longer supply by id alone. `direct` marks an
  // explicit per-image pick; `pins` holds the ids of category results that
  // claim the image — unchecking a category only removes entries it is the
  // sole claimant of, so a hand-picked member (or one shared with another
  // checked category's subtree) survives the uncheck.
  const [selectedImages, setSelectedImages] = useState<
    Map<
      number,
      { epoch: number; index: number; image: ImageItem; direct: boolean; pins: Set<number> }
    >
  >(new Map())

  const programMap = useMemo(() => new Map(programs.map((p) => [p.id, p.name])), [programs])

  // Apply initial values when the modal opens with them (render-time adjustment)
  const [prevSearchOpen, setPrevSearchOpen] = useState(open)
  const [wasSeeded, setWasSeeded] = useState(false)
  if (open && !prevSearchOpen) {
    if (initialQuery != null || initialTypeFilter != null || initialSelectMode) {
      if (initialQuery != null) setQuery(initialQuery)
      if (selectMode) setTypeFilters(new Set<TypeFilter>(['category', 'image']))
      else if (initialTypeFilter != null) setTypeFilters(new Set([initialTypeFilter]))
      setFieldFilters(new Set())
      setWasSeeded(true)
    }
  }
  if (!open && prevSearchOpen && wasSeeded) {
    setQuery('')
    setTypeFilters(new Set())
    setFieldFilters(new Set())
    setWasSeeded(false)
  }
  // Closing (or handing off to the collection dialog) always clears the
  // multi-selection — the ids are captured by the callback before reset.
  if (!open && prevSearchOpen) {
    if (selectedImages.size > 0) setSelectedImages(new Map())
  }
  if (open !== prevSearchOpen) setPrevSearchOpen(open)

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
      // Union search over clauses; "quoted phrases" count as a single clause.
      const terms = parseSearchQuery(q)
      if (terms.length === 0) return []
      const results: SearchResult[] = []

      // 1. Categories
      collectCategoryResults(categories, terms, [], results, excludeHidden, programMap)

      // 2. Images within category tree
      collectImageResults(categories, terms, [], results, excludeHidden, programMap)

      // 3. Uncategorized images
      for (const img of uncategorizedImages) {
        addImageMatches(img, terms, [], results, programMap)
      }

      // 4. Collections — visible to every role (list is server-filtered).
      if (collectionsEnabled) {
        collectCollectionResults(collections, terms, results)
      }

      // 5. Programs (hidden from students and staff)
      if (!suppressExtendedResults) {
        for (const prog of programs) {
          const m = findFirstTermMatch(prog.name, terms)
          if (m) {
            results.push({
              kind: 'program',
              entityId: prog.id,
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

      // 6. Guide pages (editor-only content)
      if (!suppressExtendedResults) {
        collectGuideResults(terms, results)
      }

      // 7. Users (hidden from students and staff)
      if (!suppressExtendedResults) {
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
                entityId: user.id,
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
      }

      return results
    },
    [
      categories,
      uncategorizedImages,
      programs,
      users,
      collections,
      collectionsEnabled,
      excludeHidden,
      suppressExtendedResults,
      programMap,
    ],
  )

  const allResults = useMemo(() => buildResults(query), [query, buildResults])

  // Apply type and field filters, then cap at MAX_RESULTS
  const filteredResults = useMemo(() => {
    let filtered = allResults
    if (typeFilters.size > 0) {
      filtered = filtered.filter((r) => typeFilters.has(r.kind))
      // A type chip also scopes the query to the fields most closely
      // associated with that type; explicit Field chips override that scope.
      if (fieldFilters.size === 0) {
        filtered = filtered.filter((r) => PRIMARY_FIELDS_BY_KIND[r.kind].includes(r.field))
      }
    }
    if (fieldFilters.size > 0) {
      filtered = filtered.filter((r) => fieldFilters.has(r.field as FieldFilter))
    }
    return filtered
  }, [allResults, typeFilters, fieldFilters])

  // Deduplicate: group by entity (kind + entityId), merge field matches
  const groupedResults = useMemo(() => {
    const groups = new Map<string, GroupedResult>()
    for (const r of filteredResults) {
      const key = `${r.kind}-${r.entityId}`
      const existing = groups.get(key)
      if (existing) {
        existing.matches.push({
          field: r.field,
          fieldValue: r.fieldValue,
          matchIndex: r.matchIndex,
          matchLength: r.matchLength,
        })
      } else {
        groups.set(key, {
          kind: r.kind,
          entityId: r.entityId,
          label: r.label,
          matches: [
            {
              field: r.field,
              fieldValue: r.fieldValue,
              matchIndex: r.matchIndex,
              matchLength: r.matchLength,
            },
          ],
          payload: r.payload,
        })
      }
    }
    return [...groups.values()]
  }, [filteredResults])

  const displayResults = useMemo(() => groupedResults.slice(0, MAX_RESULTS), [groupedResults])

  // Each new result set bumps an epoch; a check stamps the image with the
  // epoch and its position in that set. Emitting sorts by (epoch, index),
  // which is result order within one query and "order encountered" across
  // queries — selections never silently drop when the query changes.
  const resultEpochRef = useRef(0)
  const prevDisplayRef = useRef(displayResults)
  if (prevDisplayRef.current !== displayResults) {
    prevDisplayRef.current = displayResults
    resultEpochRef.current += 1
  }
  const resultEpoch = resultEpochRef.current

  const orderedSelectedImages = useMemo(
    () =>
      [...selectedImages.entries()]
        .sort((a, b) => a[1].epoch - b[1].epoch || a[1].index - b[1].index)
        .map(([, entry]) => entry.image),
    [selectedImages],
  )

  const toggleImageSelected = useCallback(
    (image: ImageItem, resultIndex: number) => {
      const epoch = resultEpoch
      setSelectedImages((prev) => {
        const next = new Map(prev)
        if (next.has(image.id)) {
          // An explicit uncheck removes the image outright — even when a
          // checked category pins it — so the category row can honestly go
          // indeterminate.
          next.delete(image.id)
        } else {
          next.set(image.id, {
            epoch,
            index: resultIndex,
            image,
            direct: true,
            pins: new Set(),
          })
        }
        return next
      })
    },
    [resultEpoch],
  )

  // Category results are bulk-toggles (#1567): checking pins every image in
  // the subtree (registration order — the shared (epoch, index) stamp +
  // stable sort keeps DFS insertion order in the emitted list). Unchecking
  // lifts this category's pin; a member only leaves the selection when no
  // pin or direct pick still claims it — a hand-picked or
  // other-category-covered member survives (#1567). Partially covered
  // subtrees show indeterminate.
  const toggleCategorySelected = useCallback(
    (categoryId: number, images: ImageItem[], resultIndex: number) => {
      const epoch = resultEpoch
      setSelectedImages((prev) => {
        const next = new Map(prev)
        const pinned =
          images.length > 0 && images.every((i) => next.get(i.id)?.pins.has(categoryId))
        if (pinned) {
          for (const img of images) {
            const entry = next.get(img.id)
            if (!entry) continue
            const pins = new Set(entry.pins)
            pins.delete(categoryId)
            if (!entry.direct && pins.size === 0) next.delete(img.id)
            else next.set(img.id, { ...entry, pins })
          }
        } else {
          for (const image of images) {
            const entry = next.get(image.id)
            if (entry) next.set(image.id, { ...entry, pins: new Set(entry.pins).add(categoryId) })
            else
              next.set(image.id, {
                epoch,
                index: resultIndex,
                image,
                direct: false,
                pins: new Set([categoryId]),
              })
          }
        }
        return next
      })
    },
    [resultEpoch],
  )

  // The selectable rows currently listed — image results plus non-empty
  // category subtrees — feeding the Select-all control (#1567).
  type SelectableRow =
    | { kind: 'image'; image: ImageItem; resultIndex: number }
    | { kind: 'category'; categoryId: number; images: ImageItem[]; resultIndex: number }
  const selectableRows = useMemo<SelectableRow[]>(
    () =>
      displayResults.flatMap((result, resultIndex): SelectableRow[] => {
        if (result.payload.kind === 'image')
          return [{ kind: 'image', image: result.payload.image, resultIndex }]
        if (result.payload.kind === 'category') {
          const cat = result.payload.categoryPath[result.payload.categoryPath.length - 1]
          const images = collectSubtreeImages(cat, excludeHidden)
          if (images.length > 0)
            return [{ kind: 'category', categoryId: cat.id, images, resultIndex }]
        }
        return []
      }),
    [displayResults, excludeHidden],
  )

  const allSelectableCovered = useMemo(
    () =>
      selectableRows.length > 0 &&
      selectableRows.every((row) =>
        row.kind === 'image'
          ? selectedImages.has(row.image.id)
          : row.images.every((i) => selectedImages.has(i.id)),
      ),
    [selectableRows, selectedImages],
  )

  const toggleSelectAll = useCallback(() => {
    const epoch = resultEpoch
    setSelectedImages((prev) => {
      const next = new Map(prev)
      if (allSelectableCovered) {
        // Unselect all: drop coverage for every listed row — image picks
        // outright, category pins with the member only leaving when no
        // other claim holds it.
        for (const row of selectableRows) {
          if (row.kind === 'image') {
            next.delete(row.image.id)
          } else {
            for (const img of row.images) {
              const entry = next.get(img.id)
              if (!entry) continue
              const pins = new Set(entry.pins)
              pins.delete(row.categoryId)
              if (!entry.direct && pins.size === 0) next.delete(img.id)
              else next.set(img.id, { ...entry, pins })
            }
          }
        }
      } else {
        for (const row of selectableRows) {
          if (row.kind === 'image') {
            const entry = next.get(row.image.id)
            if (entry) next.set(row.image.id, { ...entry, direct: true })
            else
              next.set(row.image.id, {
                epoch,
                index: row.resultIndex,
                image: row.image,
                direct: true,
                pins: new Set(),
              })
          } else {
            for (const image of row.images) {
              const entry = next.get(image.id)
              if (entry)
                next.set(image.id, { ...entry, pins: new Set(entry.pins).add(row.categoryId) })
              else
                next.set(image.id, {
                  epoch,
                  index: row.resultIndex,
                  image,
                  direct: false,
                  pins: new Set([row.categoryId]),
                })
            }
          }
        }
      }
      return next
    })
  }, [allSelectableCovered, selectableRows, resultEpoch])

  const handleAddSelected = () => {
    if (orderedSelectedImages.length === 0) return
    onClose()
    onAddImagesToCollection?.(orderedSelectedImages)
  }

  const handleSelect = (result: GroupedResult) => {
    onClose()
    switch (result.payload.kind) {
      case 'category':
        onSelectCategory(result.payload.categoryPath)
        break
      case 'image':
        onSelectImage(result.payload.image, result.payload.categoryPath)
        break
      case 'program':
        onSelectProgram(result.label)
        break
      case 'user':
        onSelectUser(result.payload.userId)
        break
      case 'guide':
        onSelectGuide?.(result.payload.slug, result.payload.anchor)
        break
      case 'collection':
        onSelectCollection?.(result.payload.collection.id)
        break
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-label="Search"
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
          placeholder={
            suppressExtendedResults
              ? `Search ${collectionsEnabled ? 'categories, images, and collections' : 'categories and images'} — "quotes" for exact phrases`
              : `Search ${collectionsEnabled ? 'categories, images, collections, programs, people, the guide' : 'categories, images, programs, people, the guide'} — "quotes" for exact phrases`
          }
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
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ alignSelf: 'center', mr: 0.5 }}
            >
              Type:
            </Typography>
            {/* The picker offers only the two addable kinds — Categories and
                Images, pre-applied — no other type or field chips (#1567). */}
            {TYPE_FILTERS.filter((f) =>
              selectMode
                ? f.key === 'category' || f.key === 'image'
                : (f.key !== 'collection' || collectionsEnabled) &&
                  !(
                    suppressExtendedResults &&
                    (f.key === 'program' || f.key === 'user' || f.key === 'guide')
                  ),
            ).map((f) => (
              <Tooltip key={f.key} title={f.tooltip}>
                <Chip
                  data-testid="type-filter-chip"
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
            {!selectMode && (
              <>
                <Box sx={{ mx: 0.5, borderLeft: 1, borderColor: 'divider' }} />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ alignSelf: 'center', mr: 0.5 }}
                >
                  Field:
                </Typography>
                {FIELD_FILTERS.filter((f) => !(suppressExtendedResults && f.key === 'Role')).map(
                  (f) => (
                    <Tooltip key={f.key} title={f.tooltip}>
                      <Chip
                        data-testid="field-filter-chip"
                        icon={f.icon}
                        label={f.label}
                        size="small"
                        sx={{ px: 0.5 }}
                        variant={fieldFilters.has(f.key) ? 'filled' : 'outlined'}
                        color={fieldFilters.has(f.key) ? 'primary' : 'default'}
                        onClick={() => toggleFieldFilter(f.key)}
                      />
                    </Tooltip>
                  ),
                )}
              </>
            )}
          </Box>
        )}

        {/* The results region is a flex column whose list alone scrolls —
            the select-all/results header stays pinned above it (#1567). */}
        <Box sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {query.trim().length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexGrow: 1,
                minHeight: 200,
              }}
            >
              <Typography variant="body1" color="text.secondary">
                Start typing to search&hellip;
              </Typography>
            </Box>
          ) : groupedResults.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexGrow: 1,
                minHeight: 200,
              }}
            >
              <Typography variant="body1" color="text.secondary">
                No results found for &ldquo;{query}&rdquo;
              </Typography>
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, flexShrink: 0 }}>
                {/* Picker mode (#1567): a bulk select/unselect for every
                    selectable row currently listed — image results and
                    category subtrees alike. */}
                {selectMode && selectableRows.length > 0 && (
                  <Button
                    size="small"
                    data-testid="search-select-all"
                    onClick={toggleSelectAll}
                    sx={{ mr: 1, flexShrink: 0 }}
                  >
                    {allSelectableCovered ? 'Unselect all' : 'Select all'}
                  </Button>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                  {groupedResults.length > MAX_RESULTS
                    ? `Showing ${MAX_RESULTS} of ${groupedResults.length} results`
                    : `${groupedResults.length} result${groupedResults.length !== 1 ? 's' : ''}`}
                </Typography>
              </Box>
              <Box
                sx={{
                  flexGrow: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                {displayResults.map((result, resultIndex) => {
                  const chipNames = getResultProgramNames(result, programMap)
                  const catPath =
                    result.payload.kind === 'image' ? result.payload.categoryPath : null
                  const image = result.payload.kind === 'image' ? result.payload.image : null
                  // Categories are selectable too (#1567): checking one adds
                  // every image in its subtree (sub-categories included) in
                  // registration order.
                  const resultCategory =
                    result.payload.kind === 'category'
                      ? result.payload.categoryPath[result.payload.categoryPath.length - 1]
                      : null
                  const subtreeImages = resultCategory
                    ? collectSubtreeImages(resultCategory, excludeHidden)
                    : null
                  const subtreeSelected =
                    subtreeImages?.filter((i) => selectedImages.has(i.id)).length ?? 0
                  // Only image/category results are selectable; in select mode
                  // the row becomes a <label> around a real checkbox so clicking
                  // anywhere toggles and keyboard users reach the control.
                  const selectable = selectMode && (image != null || subtreeImages != null)
                  const rowInner = (
                    <>
                      {image?.thumb ? (
                        <RenewingThumbnail
                          image={image}
                          alt={result.label}
                          onImageRenewed={onImageRenewed}
                          sx={{
                            width: 40,
                            height: 40,
                            objectFit: 'cover',
                            borderRadius: 0.5,
                            flexShrink: 0,
                          }}
                        />
                      ) : result.kind !== 'program' ? (
                        /* Kind icons top-align next to the title line while
                           thumbnails and checkboxes stay row-centred (#1567). */
                        <Box
                          sx={{ display: 'flex', flexShrink: 0, alignSelf: 'flex-start', mt: 0.25 }}
                        >
                          {iconForKind(result.kind)}
                        </Box>
                      ) : null}
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            mb: 0.25,
                            flexWrap: 'wrap',
                          }}
                        >
                          {result.kind === 'program' ? (
                            <Chip
                              data-testid="program-result-chip"
                              label={result.label}
                              size="small"
                            />
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
                          {!suppressExtendedResults && chipNames.length > 0 && (
                            <Box
                              sx={{
                                display: 'flex',
                                gap: 0.5,
                                ml: 'auto',
                                flexWrap: 'wrap',
                                justifyContent: 'flex-end',
                              }}
                            >
                              {chipNames.map((name) => (
                                <Chip
                                  key={name}
                                  data-testid="program-chip"
                                  label={name}
                                  size="small"
                                  color="primary"
                                />
                              ))}
                            </Box>
                          )}
                        </Box>
                        {result.matches.map((fm, mi) => {
                          const { before, match, after } = contextSnippet(
                            fm.fieldValue,
                            fm.matchIndex,
                            fm.matchLength,
                          )
                          return (
                            <Typography
                              key={mi}
                              variant="body2"
                              color="text.secondary"
                              sx={{ wordBreak: 'break-word' }}
                            >
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                component="span"
                                sx={{ fontWeight: 700 }}
                              >
                                {fm.field}:{' '}
                              </Typography>
                              {before}
                              <Box
                                component="span"
                                sx={{
                                  bgcolor: 'warning.light',
                                  color: 'warning.contrastText',
                                  borderRadius: 0.5,
                                  px: 0.25,
                                }}
                              >
                                {match}
                              </Box>
                              {after}
                            </Typography>
                          )
                        })}
                        {catPath && catPath.length > 0 && (
                          <Box
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              mt: 0.5,
                              flexWrap: 'wrap',
                            }}
                          >
                            <CategoryIcon sx={{ fontSize: 14, color: 'text.disabled', mr: 0.5 }} />
                            {catPath.map((cat, ci) => (
                              <Box
                                component="span"
                                key={cat.id}
                                sx={{ display: 'inline-flex', alignItems: 'center' }}
                              >
                                {ci > 0 && (
                                  <ChevronRightIcon
                                    sx={{ fontSize: 14, color: 'text.disabled', mx: 0.25 }}
                                  />
                                )}
                                <Typography variant="caption" color="text.secondary">
                                  {cat.label}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        )}
                        {result.payload.kind === 'collection' && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 0.5 }}
                          >
                            {result.payload.collection.type === 'synchronized'
                              ? 'Synchronized'
                              : 'Sequence'}{' '}
                            · {result.payload.collection.imageCount}{' '}
                            {result.payload.collection.imageCount === 1 ? 'image' : 'images'} ·{' '}
                            {describeCollectionOwners(result.payload.collection.owners)}
                          </Typography>
                        )}
                      </Box>
                    </>
                  )
                  return (
                    // Keep natural height — a shrunken card clips its content
                    // instead of letting the list scroll (#1567).
                    <Card
                      key={`${result.kind}-${result.entityId}`}
                      variant="outlined"
                      sx={{ flexShrink: 0 }}
                    >
                      {selectable ? (
                        <Box
                          component="label"
                          data-testid="search-select-row"
                          sx={{
                            p: 2,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'action.hover' },
                          }}
                        >
                          <Checkbox
                            data-testid="search-select-checkbox"
                            checked={
                              image != null
                                ? selectedImages.has(image.id)
                                : subtreeImages != null &&
                                  subtreeImages.length > 0 &&
                                  subtreeSelected === subtreeImages.length
                            }
                            indeterminate={
                              subtreeImages != null &&
                              subtreeSelected > 0 &&
                              subtreeSelected < subtreeImages.length
                            }
                            disabled={subtreeImages != null && subtreeImages.length === 0}
                            onChange={() =>
                              image != null
                                ? toggleImageSelected(image, resultIndex)
                                : subtreeImages &&
                                  resultCategory &&
                                  toggleCategorySelected(
                                    resultCategory.id,
                                    subtreeImages,
                                    resultIndex,
                                  )
                            }
                            slotProps={{
                              input: {
                                'aria-label': `Select ${image?.name ?? result.label}`,
                              },
                            }}
                            sx={{ p: 0.5 }}
                          />
                          {rowInner}
                        </Box>
                      ) : (
                        <CardActionArea
                          data-testid="search-result-action-area"
                          onClick={() => handleSelect(result)}
                          sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}
                        >
                          {rowInner}
                        </CardActionArea>
                      )}
                    </Card>
                  )
                })}
              </Box>
            </>
          )}
        </Box>

        {selectMode && (
          <Box
            data-testid="search-select-footer"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              pt: 1.5,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              {orderedSelectedImages.length} image{orderedSelectedImages.length === 1 ? '' : 's'}{' '}
              selected
            </Typography>
            <Button size="small" data-testid="search-select-cancel" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="contained"
              size="small"
              data-testid="search-add-to-collection"
              disabled={orderedSelectedImages.length === 0}
              onClick={handleAddSelected}
            >
              Add to collection
            </Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
