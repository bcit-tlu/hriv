import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Popover from '@mui/material/Popover'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import MuiBreadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Snackbar from '@mui/material/Snackbar'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import EditIcon from '@mui/icons-material/Edit'
import HomeIcon from '@mui/icons-material/Home'
import LinkIcon from '@mui/icons-material/Link'
import SearchIcon from '@mui/icons-material/Search'
import ImageViewer from './components/ImageViewer'
import type { ViewportState, MeasurementConfig, OverlayRect } from './components/ImageViewer'
import CategoryTile from './components/CategoryTile'
import ImageTile from './components/ImageTile'
import ManageCategoriesDialog from './components/ManageCategoriesDialog'
import AdminPage from './components/AdminPage'
import AnnouncementBanner from './components/AnnouncementBanner'
import AddEditPersonModal from './components/AddEditPersonModal'
import ManagePage from './components/ManagePage'
import PeoplePage from './components/PeoplePage'
import LoginScreen from './components/LoginScreen'
import EditImageModal from './components/EditImageModal'
import type { ImageFormData } from './components/EditImageModal'
import ProgramManagementModal from './components/ProgramManagementModal'
import ReportIssueModal from './components/ReportIssueModal'
import SearchModal from './components/SearchModal'
import UploadImageModal from './components/UploadImageModal'
import { useAuth } from './useAuth'
import {
  fetchCategoryTree,
  fetchAnnouncement,
  fetchUncategorizedImages,
  fetchSourceImage,
  createCategory as apiCreateCategory,
  deleteCategory as apiDeleteCategory,
  updateCategory as apiUpdateCategory,
  fetchUsers,
  updateUser as apiUpdateUser,
  fetchPrograms as apiFetchPrograms,
  updateImage as apiUpdateImage,
  updateAnnouncement,
  createProgram,
  updateProgram,
  deleteProgram,
} from './api'
import type { ApiCategoryTree, ApiImage, ApiUser } from './api'
import MoveCategoryDialog from './components/MoveCategoryDialog'
import type { Category, ImageItem, Program } from './types'

/** Search the category tree for an image by ID, returning the image and its category path. */
function findImageInTree(
  tree: Category[],
  imageId: number,
  path: Category[] = [],
): { image: ImageItem; path: Category[] } | null {
  for (const cat of tree) {
    for (const img of cat.images) {
      if (img.id === imageId) return { image: img, path: [...path, cat] }
    }
    const found = findImageInTree(cat.children, imageId, [...path, cat])
    if (found) return found
  }
  return null
}

function findCategoryPath(
  tree: Category[],
  categoryId: number,
  path: Category[] = [],
): Category[] | null {
  for (const cat of tree) {
    if (cat.id === categoryId) return [...path, cat]
    const found = findCategoryPath(cat.children, categoryId, [...path, cat])
    if (found) return found
  }
  return null
}

function apiTreeToCategory(node: ApiCategoryTree): Category {
  const meta = node.metadata_extra as Record<string, unknown> | null
  return {
    id: node.id,
    label: node.label,
    parentId: node.parent_id,
    children: node.children.map(apiTreeToCategory),
    images: node.images.map((img) => ({
      id: img.id,
      name: img.name,
      thumb: img.thumb,
      tileSources: img.tile_sources,
      categoryId: img.category_id,
      copyright: img.copyright,
      note: img.note,
      programIds: img.program_ids,
      active: img.active,
      createdAt: img.created_at,
      updatedAt: img.updated_at,
      metadataExtra: img.metadata_extra,
    })),
    program: node.program,
    status: node.status,
    cardImageId: typeof meta?.card_image_id === 'number' ? meta.card_image_id : null,
    metadataExtra: meta ?? null,
  }
}

export default function App() {
  const {
    currentUser,
    loading: usersLoading,
    login,
    logout,
    canManageUsers,
    canEditContent,
  } = useAuth()

  type Page = 'browse' | 'manage' | 'people' | 'admin'
  const [page, setPage] = useState<Page>('browse')
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [path, setPath] = useState<Category[]>([])
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [uncategorizedImages, setUncategorizedImages] = useState<ImageItem[]>([])

  // Shareable-URL state
  const [viewportState, setViewportState] = useState<ViewportState | undefined>(undefined)
  const [overlays, setOverlays] = useState<OverlayRect[]>([])
  const [snackOpen, setSnackOpen] = useState(false)
  const pendingImageId = useRef<number | null>(null)
  const pendingViewport = useRef<ViewportState | undefined>(undefined)
  const pendingOverlays = useRef<OverlayRect[] | undefined>(undefined)
  const uncategorizedLoaded = useRef(false)

  // Report issue modal state
  const [reportIssueOpen, setReportIssueOpen] = useState(false)

  // Image processing tracking state (supports up to 5 concurrent jobs)
  const MAX_PROCESSING_JOBS = 5
  interface ProcessingJob {
    id: number
    filename: string
    status: 'processing' | 'completed' | 'failed'
    errorMessage?: string
  }
  const [processingJobs, setProcessingJobs] = useState<ProcessingJob[]>([])
  const processingPollRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  // Search modal state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchUsers, setSearchUsers] = useState<ApiUser[]>([])

  // Manage menu state
  const [manageMenuAnchor, setManageMenuAnchor] = useState<HTMLElement | null>(null)

  // Announcement modal state (for Manage menu)
  const [annModalOpen, setAnnModalOpen] = useState(false)
  const [annMessage, setAnnMessage] = useState('')
  const [annEnabled, setAnnEnabled] = useState(false)
  const [annDraftMessage, setAnnDraftMessage] = useState('')
  const [annDraftEnabled, setAnnDraftEnabled] = useState(false)
  const [annSaving, setAnnSaving] = useState(false)
  const [annError, setAnnError] = useState<string | null>(null)

  // Program management modal state (for Manage menu)
  const [programModalOpen, setProgramModalOpen] = useState(false)

  // Move category dialog state
  const [moveCatOpen, setMoveCatOpen] = useState(false)
  const [movingCategory, setMovingCategory] = useState<Category | null>(null)

  // Image edit modal state (for viewer page)
  const [imageEditOpen, setImageEditOpen] = useState(false)

  // Image edit modal state (for browse-view ellipsis icon)
  const [browseEditImage, setBrowseEditImage] = useState<ImageItem | null>(null)

  // User profile popover + edit modal state
  const avatarRef = useRef<HTMLButtonElement>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [programs, setPrograms] = useState<Program[]>([])

  // Build ApiUser shape from currentUser for AddEditPersonModal
  const currentApiUser: ApiUser | null = currentUser
    ? {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
        program_id: currentUser.program_id ?? null,
        program_name: currentUser.program_name ?? null,
        last_access: currentUser.lastAccess ?? null,
        metadata_extra: null,
        created_at: '',
        updated_at: '',
      }
    : null

  // Start polling for each new processing job (uses setTimeout chaining to avoid overlapping calls)
  useEffect(() => {
    const refs = processingPollRefs.current
    const abortControllers = new Map<number, AbortController>()

    for (const job of processingJobs) {
      if (job.status !== 'processing') continue // only poll active jobs
      if (refs.has(job.id)) continue // already polling

      const schedulePoll = () => {
        const controller = new AbortController()
        abortControllers.set(job.id, controller)

        const poll = async () => {
          try {
            const src = await fetchSourceImage(job.id)
            if (controller.signal.aborted) return
            if (src.status === 'completed') {
              refs.delete(job.id)
              setProcessingJobs((prev) =>
                prev.map((j) => j.id === job.id ? { ...j, status: 'completed' as const } : j),
              )
              loadCategories()
              loadUncategorizedImages()
            } else if (src.status === 'failed') {
              refs.delete(job.id)
              setProcessingJobs((prev) =>
                prev.map((j) =>
                  j.id === job.id
                    ? { ...j, status: 'failed' as const, errorMessage: src.error_message || undefined }
                    : j,
                ),
              )
            } else {
              // Still processing — schedule next poll after this one completes
              if (!controller.signal.aborted) {
                refs.set(job.id, setTimeout(schedulePoll, 3000))
              }
            }
          } catch {
            // Network error — schedule retry if not aborted
            if (!controller.signal.aborted) {
              refs.set(job.id, setTimeout(schedulePoll, 3000))
            }
          }
        }

        poll()
      }

      schedulePoll()
    }

    // Clean up timeouts for jobs that were removed
    for (const [id, timeout] of refs) {
      if (!processingJobs.some((j) => j.id === id && j.status === 'processing')) {
        clearTimeout(timeout)
        refs.delete(id)
        abortControllers.get(id)?.abort()
        abortControllers.delete(id)
      }
    }

    return () => {
      for (const [, timeout] of refs) {
        clearTimeout(timeout)
      }
      refs.clear()
      for (const [, controller] of abortControllers) {
        controller.abort()
      }
      abortControllers.clear()
    }
  }, [processingJobs]) // eslint-disable-line react-hooks/exhaustive-deps


  // Load announcement (works for both logged-in and login page)
  const loadAnnouncement = useCallback(async () => {
    try {
      const ann = await fetchAnnouncement()
      setAnnouncement(ann.enabled ? ann.message : '')
      setAnnMessage(ann.message)
      setAnnEnabled(ann.enabled)
    } catch {
      // Silently ignore — announcement is non-critical
    }
  }, [])

  useEffect(() => {
    loadAnnouncement()
  }, [loadAnnouncement])

  // On mount, parse URL search params for shareable link state
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const imgId = params.get('image')
    if (imgId) {
      const parsedId = Number(imgId)
      if (!Number.isNaN(parsedId)) {
        pendingImageId.current = parsedId
        const z = params.get('zoom')
        const px = params.get('x')
        const py = params.get('y')
        if (z && px && py) {
          const zoom = parseFloat(z)
          const x = parseFloat(px)
          const y = parseFloat(py)
          if (!Number.isNaN(zoom) && !Number.isNaN(x) && !Number.isNaN(y)) {
            const rot = params.get('rotation')
            const rotation = rot ? parseFloat(rot) : undefined
            pendingViewport.current = {
              zoom,
              x,
              y,
              rotation: rotation && !Number.isNaN(rotation) ? rotation : undefined,
            }
          }
        }
        // Parse overlay rectangles (ov0..ov4) — format: x,y,w,h
        const parsedOverlays: OverlayRect[] = []
        for (let i = 0; i < 5; i++) {
          const ov = params.get(`ov${i}`)
          if (!ov) continue
          const parts = ov.split(',').map(Number)
          if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
            parsedOverlays.push({ x: parts[0], y: parts[1], w: parts[2], h: parts[3] })
          }
        }
        if (parsedOverlays.length > 0) {
          pendingOverlays.current = parsedOverlays
        }
      }
    }
  }, [])

  // Reset navigation state when user identity changes (login/logout/switch)
  useEffect(() => {
    setPage('browse')
    setPath([])
    setSelectedImage(null)
    setViewportState(undefined)
    setOverlays([])
    setProfileOpen(false)
    setEditModalOpen(false)
    setImageEditOpen(false)
    setBrowseEditImage(null)
    setSearchOpen(false)
    setSearchUsers([])
    setProcessingJobs([])
  }, [currentUser])

  // Load users for search when modal opens (admin/instructor only)
  useEffect(() => {
    if (searchOpen && canManageUsers) {
      fetchUsers()
        .then(setSearchUsers)
        .catch(() => setSearchUsers([]))
    }
  }, [searchOpen, canManageUsers])

  const loadCategories = useCallback(async () => {
    try {
      setCategoriesLoading(true)
      const tree = await fetchCategoryTree()
      setCategories(tree.map(apiTreeToCategory))
    } catch (err) {
      console.error('Failed to load categories', err)
    } finally {
      setCategoriesLoading(false)
    }
  }, [])

  const loadUncategorizedImages = useCallback(async () => {
    try {
      const imgs = await fetchUncategorizedImages()
      setUncategorizedImages(
        imgs.map((img: ApiImage) => ({
          id: img.id,
          name: img.name,
          thumb: img.thumb,
          tileSources: img.tile_sources,
          categoryId: img.category_id,
          copyright: img.copyright,
          note: img.note,
          programIds: img.program_ids,
          active: img.active,
          createdAt: img.created_at,
          updatedAt: img.updated_at,
          metadataExtra: img.metadata_extra,
        })),
      )
      uncategorizedLoaded.current = true
    } catch (err) {
      console.error('Failed to load uncategorized images', err)
      uncategorizedLoaded.current = true
    }
  }, [])

  const loadPrograms = useCallback(async () => {
    try {
      const p = await apiFetchPrograms()
      setPrograms(p.map((pg) => ({ id: pg.id, name: pg.name, created_at: pg.created_at, updated_at: pg.updated_at })))
    } catch {
      // Silently ignore — programs are non-critical for initial load
    }
  }, [])

  // Announcement modal handlers (for Manage menu)
  const openAnnModal = useCallback(() => {
    setAnnDraftMessage(annMessage)
    setAnnDraftEnabled(annEnabled)
    setAnnError(null)
    setAnnModalOpen(true)
  }, [annMessage, annEnabled])

  const handleAnnSave = useCallback(async () => {
    setAnnSaving(true)
    try {
      const updated = await updateAnnouncement({
        message: annDraftMessage,
        enabled: annDraftEnabled,
      })
      setAnnMessage(updated.message)
      setAnnEnabled(updated.enabled)
      setAnnModalOpen(false)
      loadAnnouncement()
    } catch (err) {
      setAnnError(err instanceof Error ? err.message : 'Failed to update announcement')
    } finally {
      setAnnSaving(false)
    }
  }, [annDraftMessage, annDraftEnabled, loadAnnouncement])

  // Program management handlers (for Manage menu)
  const handleAddProgram = useCallback(async (name: string) => {
    try {
      await createProgram({ name })
      await loadPrograms()
    } catch (err) {
      console.error('Failed to add program', err)
    }
  }, [loadPrograms])

  const handleEditProgram = useCallback(async (id: number, name: string) => {
    try {
      await updateProgram(id, { name })
      await loadPrograms()
    } catch (err) {
      console.error('Failed to edit program', err)
    }
  }, [loadPrograms])

  const handleDeleteProgram = useCallback(async (id: number) => {
    try {
      await deleteProgram(id)
      await loadPrograms()
    } catch (err) {
      console.error('Failed to delete program', err)
    }
  }, [loadPrograms])

  useEffect(() => {
    if (currentUser) {
      loadCategories()
      loadUncategorizedImages()
      loadPrograms()
    }
  }, [currentUser, loadCategories, loadUncategorizedImages, loadPrograms])

  // Once categories are loaded, restore a pending shared-link image
  useEffect(() => {
    if (pendingImageId.current === null || categoriesLoading) return
    const id = pendingImageId.current

    // Check uncategorized images first
    const uncatImg = uncategorizedImages.find((img) => img.id === id)
    if (uncatImg) {
      pendingImageId.current = null
      setSelectedImage(uncatImg)
      setViewportState(pendingViewport.current)
      pendingViewport.current = undefined
      if (pendingOverlays.current) {
        setOverlays(pendingOverlays.current)
        pendingOverlays.current = undefined
      }
      return
    }

    const result = findImageInTree(categories, id)
    if (result) {
      pendingImageId.current = null
      setPath(result.path)
      setSelectedImage(result.image)
      setViewportState(pendingViewport.current)
      pendingViewport.current = undefined
      if (pendingOverlays.current) {
        setOverlays(pendingOverlays.current)
        pendingOverlays.current = undefined
      }
    } else if (!categoriesLoading && uncategorizedLoaded.current) {
      // Both data sources have loaded — image doesn't exist.
      // Clear pending state and URL so URL sync can resume normally.
      pendingImageId.current = null
      pendingViewport.current = undefined
      pendingOverlays.current = undefined
      window.history.replaceState(null, '', window.location.pathname)
    }
    // Otherwise keep pendingImageId so we retry on the next data update.
  }, [categories, uncategorizedImages, categoriesLoading])

  // Keep URL search params in sync with the current view
  useEffect(() => {
    // Don't overwrite URL while a shared-link image is still pending resolution
    if (pendingImageId.current !== null) return
    const params = new URLSearchParams()
    if (selectedImage) {
      params.set('image', String(selectedImage.id))
      if (viewportState) {
        params.set('zoom', viewportState.zoom.toFixed(4))
        params.set('x', viewportState.x.toFixed(6))
        params.set('y', viewportState.y.toFixed(6))
        if (viewportState.rotation) {
          params.set('rotation', viewportState.rotation.toFixed(1))
        }
      }
      // Serialize overlay rectangles (up to 5)
      for (let i = 0; i < Math.min(overlays.length, 5); i++) {
        const r = overlays[i]
        params.set(`ov${i}`, [r.x, r.y, r.w, r.h].map((n) => n.toPrecision(8)).join(','))
      }
    }
    const qs = params.toString()
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, '', newUrl)
  }, [selectedImage, viewportState, overlays])

  const handleViewportChange = useCallback((state: ViewportState) => {
    setViewportState(state)
  }, [])

  const handleOverlaysChange = useCallback((newOverlays: OverlayRect[]) => {
    setOverlays(newOverlays)
  }, [])

  // Memoize initialViewport so it stays referentially stable per image
  const initialViewport = useMemo(() => viewportState, [selectedImage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Memoize initialOverlays so they stay referentially stable per image
  const initialOverlays = useMemo(() => overlays, [selectedImage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build measurement config from the selected image's metadata
  const selectedImageMeasurement = useMemo((): MeasurementConfig | undefined => {
    const meta = selectedImage?.metadataExtra
    if (!meta) return undefined
    const scale = typeof meta.measurement_scale === 'number' ? meta.measurement_scale : undefined
    const unit = typeof meta.measurement_unit === 'string' ? meta.measurement_unit : undefined
    if (!scale && !unit) return undefined
    return { scale, unit }
  }, [selectedImage])

  const copyShareLink = useCallback(() => {
    const url = window.location.href
    const fallbackCopy = () => {
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setSnackOpen(true)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setSnackOpen(true)
      }).catch(fallbackCopy)
    } else {
      fallbackCopy()
    }
  }, [])

  // Resolve the live children/images from the categories state tree
  // so newly added categories appear immediately.
  const resolve = useCallback((): { cats: Category[]; imgs: ImageItem[] } => {
    let node = categories
    for (const segment of path) {
      const found = node.find((c) => c.id === segment.id)
      if (!found) return { cats: [], imgs: [] }
      node = found.children
      if (segment === path[path.length - 1]) {
        return { cats: found.children, imgs: found.images }
      }
    }
    return { cats: node, imgs: [] }
  }, [categories, path])

  const { cats: resolvedCategories, imgs: currentImages } = resolve()

  // Filter out hidden categories for students in browse mode
  const isStudent = currentUser?.role === 'student'
  const currentCategories = isStudent
    ? resolvedCategories.filter((c) => c.status !== 'hidden')
    : resolvedCategories

  const clearImage = useCallback(() => {
    setSelectedImage(null)
    setViewportState(undefined)
    setOverlays([])
  }, [])

  const navigateToCategory = (cat: Category) => {
    setPath((prev) => [...prev, cat])
  }

  const navigateToDepth = (depth: number) => {
    setPath((prev) => prev.slice(0, depth))
  }

  const addCategoryInline = useCallback(
    async (label: string, parentId: number | null) => {
      try {
        await apiCreateCategory({ label, parent_id: parentId })
        await loadCategories()
        loadUncategorizedImages()
      } catch (err) {
        console.error('Failed to create category', err)
      }
    },
    [loadCategories, loadUncategorizedImages],
  )

  const deleteCategoryInline = useCallback(
    async (categoryId: number) => {
      try {
        await apiDeleteCategory(categoryId)
        // Clear path segments that reference the deleted category
        setPath((prev) => {
          const idx = prev.findIndex((seg) => seg.id === categoryId)
          return idx >= 0 ? prev.slice(0, idx) : prev
        })
        await loadCategories()
        loadUncategorizedImages()
      } catch (err) {
        console.error('Failed to delete category', err)
      }
    },
    [loadCategories, loadUncategorizedImages],
  )

  const editCategoryInline = useCallback(
    async (categoryId: number, newLabel: string) => {
      try {
        await apiUpdateCategory(categoryId, { label: newLabel })
        await loadCategories()
      } catch (err) {
        console.error('Failed to rename category', err)
      }
    },
    [loadCategories],
  )

  const toggleCategoryVisibility = useCallback(
    async (categoryId: number, hidden: boolean) => {
      try {
        await apiUpdateCategory(categoryId, { status: hidden ? 'hidden' : 'active' })
        await loadCategories()
      } catch (err) {
        console.error('Failed to toggle category visibility', err)
      }
    },
    [loadCategories],
  )

  const handleMoveCategory = useCallback(
    async (categoryId: number, newParentId: number | null) => {
      try {
        await apiUpdateCategory(categoryId, { parent_id: newParentId })
        setMoveCatOpen(false)
        setMovingCategory(null)
        await loadCategories()
      } catch (err) {
        console.error('Failed to move category', err)
      }
    },
    [loadCategories],
  )

  const handleRequestMoveCategory = useCallback((cat: Category) => {
    setMovingCategory(cat)
    setMoveCatOpen(true)
  }, [])

  const handleSetCardImage = useCallback(
    async (categoryId: number, imageId: number | null) => {
      try {
        // Find existing metadata so we merge rather than overwrite
        const findCat = (cats: Category[]): Category | null => {
          for (const c of cats) {
            if (c.id === categoryId) return c
            const found = findCat(c.children)
            if (found) return found
          }
          return null
        }
        const existing = findCat(categories)?.metadataExtra ?? {}
        await apiUpdateCategory(categoryId, {
          metadata_extra: { ...existing, card_image_id: imageId },
        })
        await loadCategories()
      } catch (err) {
        console.error('Failed to set card image', err)
      }
    },
    [loadCategories, categories],
  )

  // Build ApiImage shape from selectedImage for EditImageModal on viewer page
  const selectedApiImage: ApiImage | null = selectedImage
    ? {
        id: selectedImage.id,
        name: selectedImage.name,
        thumb: selectedImage.thumb,
        tile_sources: selectedImage.tileSources,
        category_id: selectedImage.categoryId ?? null,
        copyright: selectedImage.copyright ?? null,
        note: selectedImage.note ?? null,
        program_ids: selectedImage.programIds,
        active: selectedImage.active,
        metadata_extra: selectedImage.metadataExtra ?? null,
        created_at: selectedImage.createdAt ?? '',
        updated_at: selectedImage.updatedAt ?? '',
      }
    : null

  // Build ApiImage shape from browseEditImage for EditImageModal on browse page
  const browseApiImage: ApiImage | null = browseEditImage
    ? {
        id: browseEditImage.id,
        name: browseEditImage.name,
        thumb: browseEditImage.thumb,
        tile_sources: browseEditImage.tileSources,
        category_id: browseEditImage.categoryId ?? null,
        copyright: browseEditImage.copyright ?? null,
        note: browseEditImage.note ?? null,
        program_ids: browseEditImage.programIds,
        active: browseEditImage.active,
        metadata_extra: browseEditImage.metadataExtra ?? null,
        created_at: browseEditImage.createdAt ?? '',
        updated_at: browseEditImage.updatedAt ?? '',
      }
    : null

  const handleSaveBrowseImage = useCallback(
    async (data: ImageFormData) => {
      if (!browseEditImage) return
      try {
        await apiUpdateImage(browseEditImage.id, data)
        setBrowseEditImage(null)
        await loadCategories()
        loadUncategorizedImages()
      } catch (err) {
        console.error('Failed to update image', err)
      }
    },
    [browseEditImage, loadCategories, loadUncategorizedImages],
  )

  const handleSaveViewerImage = useCallback(
    async (data: ImageFormData) => {
      if (!selectedImage) return
      try {
        const updated = await apiUpdateImage(selectedImage.id, data)
        setSelectedImage({
          id: updated.id,
          name: updated.name,
          thumb: updated.thumb,
          tileSources: updated.tile_sources,
          categoryId: updated.category_id,
          copyright: updated.copyright,
          note: updated.note,
          programIds: updated.program_ids,
          active: updated.active,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
          metadataExtra: updated.metadata_extra,
        })
        setImageEditOpen(false)
        // Refresh categories and update breadcrumb path from the fresh tree
        const freshTree = (await fetchCategoryTree()).map(apiTreeToCategory)
        setCategories(freshTree)
        if (updated.category_id != null) {
          const newPath = findCategoryPath(freshTree, updated.category_id)
          setPath(newPath ?? [])
        } else {
          setPath([])
        }
        loadUncategorizedImages()
      } catch (err) {
        console.error('Failed to update image', err)
      }
    },
    [selectedImage, loadUncategorizedImages],
  )

  // Show loading spinner while users are loading
  if (usersLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  // Show login screen when no user is authenticated
  if (!currentUser) {
    return <LoginScreen onLogin={login} announcement={announcement} />
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* App bar */}
      <AppBar position="static" elevation={1}>
        <Toolbar>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mr: 2,
            }}
          >
            <Box
              component="img"
              src="/favicon.svg"
              alt="Corgi"
              sx={{ height: 32, width: 32 }}
            />
            <Typography variant="h6" component="h1">
              Corgi
            </Typography>
          </Box>
          <Tabs
            value={page}
            onChange={(_, v: Page) => {
              if (v === 'browse' || v === 'manage' || v === 'people' || v === 'admin') {
                setPage(v)
                clearImage()
                setPath([])
              }
            }}
            textColor="inherit"
            TabIndicatorProps={{ style: { backgroundColor: 'white' } }}
            sx={{ flexGrow: 1 }}
          >
            <Tab
              label="Home"
              value="browse"
              onClick={() => {
                setPage('browse')
                clearImage()
                setPath([])
              }}
            />
            {canEditContent && <Tab label="Images" value="manage" />}
            {canEditContent && (
              <Tab
                label="Manage"
                value={false}
                onClick={(e) => setManageMenuAnchor(e.currentTarget)}
              />
            )}
            {canManageUsers && <Tab label="People" value="people" />}
            {canManageUsers && <Tab label="Admin" value="admin" />}
          </Tabs>
          <Menu
            anchorEl={manageMenuAnchor}
            open={Boolean(manageMenuAnchor)}
            onClose={() => setManageMenuAnchor(null)}
          >
            <MenuItem onClick={() => { setManageMenuAnchor(null); setDialogOpen(true) }}>Categories</MenuItem>
            <MenuItem onClick={() => { setManageMenuAnchor(null); setProgramModalOpen(true) }}>Programs</MenuItem>
            <MenuItem onClick={() => { setManageMenuAnchor(null); openAnnModal() }}>Announcement</MenuItem>
          </Menu>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title="Search">
              <IconButton
                onClick={() => setSearchOpen(true)}
                sx={{ color: 'inherit' }}
                aria-label="Search"
              >
                <SearchIcon />
              </IconButton>
            </Tooltip>
            <IconButton
              ref={avatarRef}
              onClick={() => setProfileOpen(true)}
              sx={{ p: 0 }}
            >
              <Avatar
                sx={{
                  width: 34,
                  height: 34,
                  fontSize: 14,
                  bgcolor: 'rgba(255,255,255,0.25)',
                  color: 'white',
                }}
              >
                {currentUser.name
                  .split(' ')
                  .map((w) => w[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)}
              </Avatar>
            </IconButton>
            <Popover
              open={profileOpen}
              anchorEl={avatarRef.current}
              onClose={() => setProfileOpen(false)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <Card sx={{ minWidth: 240 }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {currentUser.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {currentUser.email}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                    {currentUser.role}
                  </Typography>
                  {currentUser.program_name && (
                    <Typography variant="body2" color="text.secondary">
                      {currentUser.program_name}
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', justifyContent: canManageUsers ? 'space-between' : 'flex-end', mt: 2 }}>
                    {canManageUsers && (
                      <Link
                        component="button"
                        variant="body2"
                        onClick={() => {
                          setProfileOpen(false)
                          loadPrograms()
                          setEditModalOpen(true)
                        }}
                      >
                        Update
                      </Link>
                    )}
                    <Link
                      component="button"
                      variant="body2"
                      color="primary"
                      onClick={() => {
                        setProfileOpen(false)
                        logout()
                      }}
                    >
                      Logout
                    </Link>
                  </Box>
                </CardContent>
              </Card>
            </Popover>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Announcement banner */}
      {announcement && <AnnouncementBanner message={announcement} />}

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          py: 3,
          bgcolor: page === 'people' || page === 'admin' ? '#DAC7B5' : undefined,
        }}
      >
        <Container maxWidth={false} sx={{ px: { xs: 2, sm: 3, lg: '72px', xl: '120px' } }}>
          {page === 'admin' && canManageUsers ? (
            <AdminPage />
          ) : page === 'people' && canManageUsers ? (
            <PeoplePage />
          ) : page === 'manage' && canEditContent ? (
            <ManagePage
              categories={categories}
              onEditCategory={editCategoryInline}
              onToggleVisibility={toggleCategoryVisibility}
              onViewImage={(img) => {
                setSelectedImage({
                  id: img.id,
                  name: img.name,
                  thumb: img.thumb,
                  tileSources: img.tile_sources,
                  categoryId: img.category_id,
                  copyright: img.copyright,
                  note: img.note,
                  programIds: img.program_ids,
                  active: img.active,
                  createdAt: img.created_at,
                  updatedAt: img.updated_at,
                  metadataExtra: img.metadata_extra,
                })
                // Build breadcrumb path from the image's category
                if (img.category_id != null) {
                  const catPath = findCategoryPath(categories, img.category_id)
                  if (catPath) setPath(catPath)
                } else {
                  setPath([])
                }
                setPage('browse')
              }}
              onNavigateCategory={(categoryPath) => {
                setPath(categoryPath)
                setPage('browse')
              }}
              onCategoriesChanged={() => {
                loadCategories()
                loadUncategorizedImages()
              }}

              onAddCategory={addCategoryInline}
            />
          ) : selectedImage ? (
            /* ---- Viewer mode ---- */
            <>
              {/* Breadcrumbs + action buttons */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: 2,
                  flexWrap: 'wrap',
                  gap: 1,
                }}
              >
                <MuiBreadcrumbs aria-label="image breadcrumb">
                  <Link
                    component="button"
                    variant="body2"
                    underline="hover"
                    color="inherit"
                    onClick={() => {
                      clearImage()
                      navigateToDepth(0)
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      cursor: 'pointer',
                    }}
                  >
                    <HomeIcon fontSize="small" />
                    Home
                  </Link>
                  {path.map((cat, i) => (
                    <Link
                      key={cat.id}
                      component="button"
                      variant="body2"
                      underline="hover"
                      color="inherit"
                      onClick={() => {
                        clearImage()
                        navigateToDepth(i + 1)
                      }}
                      sx={{ cursor: 'pointer' }}
                    >
                      {cat.label}
                    </Link>
                  ))}
                  <Typography variant="body2" color="text.primary">
                    {selectedImage.name}
                  </Typography>
                </MuiBreadcrumbs>
                <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  {canEditContent && (
                    <Button
                      variant="contained"
                      startIcon={<EditIcon />}
                      onClick={() => setImageEditOpen(true)}
                    >
                      Edit Details
                    </Button>
                  )}
                  <Tooltip title="Copy shareable link to clipboard">
                    <Button
                      variant="outlined"
                      startIcon={<LinkIcon />}
                      onClick={copyShareLink}
                    >
                      Share View
                    </Button>
                  </Tooltip>
                </Box>
              </Box>

              <Paper elevation={3} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <ImageViewer
                  tileSources={selectedImage.tileSources}
                  initialViewport={initialViewport}
                  onViewportChange={handleViewportChange}
                  measurement={selectedImageMeasurement}
                  initialOverlays={initialOverlays}
                  onOverlaysChange={handleOverlaysChange}
                />
              </Paper>

              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Scroll or tap to zoom, and drag to pan. Buttons in the bottom left corner control the view. On touch-devices, pinch-turn to rotate. The mini-map in the bottom-right corner shows your current viewport.
                </Typography>
              </Box>

              {/* Image metadata */}
              <Box
                sx={{
                  mt: 2,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 0,
                  '& > span': { mr: '2em' },
                }}
              >
                {selectedImage.copyright && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>Copyright:</strong> {selectedImage.copyright}
                  </Typography>
                )}
                {selectedImage.programIds.length > 0 && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>Program{selectedImage.programIds.length > 1 ? 's' : ''}:</strong>{' '}
                    {selectedImage.programIds
                      .map((pid) => programs.find((p) => p.id === pid)?.name ?? pid)
                      .join(', ')}
                  </Typography>
                )}
                {selectedImage.note && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>Note:</strong> {selectedImage.note}
                  </Typography>
                )}
                {selectedImage.createdAt && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>Created:</strong> {new Date(selectedImage.createdAt).toLocaleString()}
                  </Typography>
                )}
                {selectedImage.updatedAt && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>Modified:</strong> {new Date(selectedImage.updatedAt).toLocaleString()}
                  </Typography>
                )}
              </Box>
            </>
          ) : (
            /* ---- Browse mode ---- */
            <>
              {/* Breadcrumbs + action buttons */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: 2,
                  flexWrap: 'wrap',
                  gap: 1,
                }}
              >
                <MuiBreadcrumbs aria-label="category breadcrumb">
                  <Link
                    component="button"
                    variant="body2"
                    underline="hover"
                    color={path.length === 0 ? 'text.primary' : 'inherit'}
                    onClick={() => navigateToDepth(0)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      cursor: 'pointer',
                    }}
                  >
                    <HomeIcon fontSize="small" />
                    Home
                  </Link>
                  {path.map((cat, i) => (
                    <Link
                      key={cat.id}
                      component="button"
                      variant="body2"
                      underline="hover"
                      color={
                        i === path.length - 1 ? 'text.primary' : 'inherit'
                      }
                      onClick={() => navigateToDepth(i + 1)}
                      sx={{ cursor: 'pointer' }}
                    >
                      {cat.label}
                    </Link>
                  ))}
                </MuiBreadcrumbs>
                {canEditContent && (
                  <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    <Button
                      variant="contained"
                      startIcon={<AddPhotoAlternateIcon />}
                      onClick={() => setUploadOpen(true)}
                    >
                      Add Image
                    </Button>
                  </Box>
                )}
              </Box>

              {/* Tile grid */}
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 2,
                }}
              >
                {currentCategories.map((cat) => (
                    <CategoryTile
                      key={cat.id}
                      category={cat}
                      onClick={navigateToCategory}
                      onMove={canEditContent ? handleRequestMoveCategory : undefined}
                      onSetCardImage={canEditContent ? handleSetCardImage : undefined}
                      programs={programs}
                    />
                ))}
                {path.length === 0 &&
                  uncategorizedImages.map((img) => (
                    <ImageTile
                      key={img.id}
                      image={img}
                      onClick={setSelectedImage}
                      programs={programs}
                      onEditDetails={canEditContent ? setBrowseEditImage : undefined}
                    />
                  ))}
                {currentImages.map((img) => (
                  <ImageTile
                    key={img.id}
                    image={img}
                    onClick={setSelectedImage}
                    programs={programs}
                    onEditDetails={canEditContent ? setBrowseEditImage : undefined}
                  />
                ))}
              </Box>

              {categoriesLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                  <CircularProgress />
                </Box>
              ) : (
                currentCategories.length === 0 &&
                currentImages.length === 0 &&
                (path.length > 0 || uncategorizedImages.length === 0) && (
                  <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{ mt: 4, textAlign: 'center' }}
                  >
                    This category is empty. Add a sub-category to get started.
                  </Typography>
                )
              )}
            </>
          )}
        </Container>
      </Box>

      {/* Footer */}
      <Box
        component="footer"
        sx={{
          py: 1,
          px: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          bgcolor: 'background.default',
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          <strong>BCIT Teaching and Learning Unit</strong>
          {' - '}
          <strong>Source code:</strong>{' '}
          <Link
            href="https://www.mozilla.org/en-US/MPL/2.0/"
            target="_blank"
            rel="noopener noreferrer"
            color="text.secondary"
            underline="hover"
          >
            MPL-2.0
          </Link>
          {' - '}
          <strong>Version:</strong>{' '}
          <Link
            href={
              import.meta.env.VITE_APP_VERSION && import.meta.env.VITE_APP_VERSION !== 'dev'
                ? `https://github.com/bcit-tlu/corgi/releases`
                : `https://github.com/bcit-tlu/corgi`
            }
            target="_blank"
            rel="noopener noreferrer"
            color="text.secondary"
            underline="hover"
          >
            {import.meta.env.VITE_APP_VERSION || 'dev'}
          </Link>
        </Typography>
        <Link
          component="button"
          variant="caption"
          color="text.secondary"
          underline="hover"
          onClick={() => setReportIssueOpen(true)}
          sx={{ cursor: 'pointer' }}
        >
          Report issue
        </Link>
      </Box>

      {/* Manage categories dialog */}
      <ManageCategoriesDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        categories={categories}
        onAddCategory={addCategoryInline}
        onDeleteCategory={deleteCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
      />

      {/* Move category dialog */}
      <MoveCategoryDialog
        open={moveCatOpen}
        onClose={() => {
          setMoveCatOpen(false)
          setMovingCategory(null)
        }}
        onMove={handleMoveCategory}
        category={movingCategory}
        categories={categories}
        onAddCategory={addCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
      />

      {/* Image edit modal (viewer page) */}
      <EditImageModal
        open={imageEditOpen}
        onClose={() => setImageEditOpen(false)}
        onSave={handleSaveViewerImage}
        image={selectedApiImage}
        categories={categories}
        programs={programs}
        onAddCategory={addCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
      />

      {/* Browse-view image edit modal */}
      <EditImageModal
        open={browseEditImage != null}
        onClose={() => setBrowseEditImage(null)}
        onSave={handleSaveBrowseImage}
        image={browseApiImage}
        categories={categories}
        programs={programs}
        onAddCategory={addCategoryInline}
      />

      {/* Upload image modal */}
      <UploadImageModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          loadCategories()
          loadUncategorizedImages()
        }}
        onProcessingStarted={(sourceImageId, filename) => {
          setProcessingJobs((prev) => {
            if (prev.filter((j) => j.status === 'processing').length >= MAX_PROCESSING_JOBS) return prev
            if (prev.some((j) => j.id === sourceImageId)) return prev
            return [...prev, { id: sourceImageId, filename, status: 'processing' as const }]
          })
        }}
        categoryId={path.length > 0 ? path[path.length - 1].id : null}
        categories={categories}
        programs={programs}
        onAddCategory={addCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
      />

      {/* Self-edit profile modal */}
      <AddEditPersonModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSave={async (data) => {
          if (!currentUser) return
          try {
            await apiUpdateUser(currentUser.id, data)
            setEditModalOpen(false)
            // Refresh current user data by re-validating the token
            window.location.reload()
          } catch (err) {
            console.error('Failed to update profile', err)
          }
        }}
        programs={programs}
        user={currentApiUser}
      />

      {/* Announcement modal (from Manage menu) */}
      <Dialog
        open={annModalOpen}
        onClose={() => setAnnModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Manage Announcement</DialogTitle>
        <DialogContent>
          <TextField
            label="Announcement Message"
            multiline
            minRows={3}
            maxRows={8}
            fullWidth
            value={annDraftMessage}
            onChange={(e) => setAnnDraftMessage(e.target.value)}
            sx={{ mt: 1 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={annDraftEnabled}
                onChange={(e) => setAnnDraftEnabled(e.target.checked)}
              />
            }
            label="Enable announcement"
            sx={{ mt: 2 }}
          />
          {annError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setAnnError(null)}>
              {annError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAnnSave}
            disabled={annSaving}
            startIcon={annSaving ? <CircularProgress size={18} color="inherit" /> : undefined}
          >
            {annSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Program management modal (from Manage menu) */}
      <ProgramManagementModal
        open={programModalOpen}
        onClose={() => setProgramModalOpen(false)}
        programs={programs}
        onAdd={handleAddProgram}
        onEdit={handleEditProgram}
        onDelete={handleDeleteProgram}
      />


      {/* Report issue modal */}
      <ReportIssueModal
        open={reportIssueOpen}
        onClose={() => setReportIssueOpen(false)}
      />

      {/* Search modal */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        categories={categories}
        uncategorizedImages={uncategorizedImages}
        programs={programs}
        users={searchUsers}
        isStudent={isStudent}
        onSelectCategory={(catPath) => {
          setPage('browse')
          setPath(catPath)
          clearImage()
        }}
        onSelectImage={(image, catPath) => {
          setPage('browse')
          setPath(catPath)
          setSelectedImage(image)
          setViewportState(undefined)
          setOverlays([])
        }}
        onSelectProgram={() => {
          if (canManageUsers) setPage('people')
        }}
        onSelectUser={() => {
          if (canManageUsers) setPage('people')
        }}
      />

      {/* Share-link snackbar */}
      <Snackbar
        open={snackOpen}
        autoHideDuration={3000}
        onClose={() => setSnackOpen(false)}
        message="Link copied to clipboard"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        sx={{ zIndex: 1500, bottom: { xs: `${24 + processingJobs.length * 60}px !important` } }}
      />

      {/* Image processing snackbars (one per job, stacked above modals) */}
      {processingJobs.map((job, index) => (
        <Snackbar
          key={job.id}
          open
          autoHideDuration={job.status !== 'processing' ? 6000 : null}
          onClose={(_event, reason) => { if (reason === 'clickaway') return; setProcessingJobs((prev) => prev.filter((j) => j.id !== job.id)) }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{ zIndex: 1500, bottom: { xs: `${24 + index * 60}px !important` } }}
        >
          <Alert
            severity={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'info'}
            variant="filled"
            sx={{ width: '100%', display: 'flex', alignItems: 'center' }}
            icon={job.status === 'processing' ? <CircularProgress size={20} sx={{ color: 'inherit' }} /> : undefined}
            onClose={() => setProcessingJobs((prev) => prev.filter((j) => j.id !== job.id))}
          >
            {job.status === 'processing' && `Processing: ${job.filename}`}
            {job.status === 'completed' && `"${job.filename}" processed successfully!`}
            {job.status === 'failed' && (job.errorMessage || `"${job.filename}" processing failed.`)}
          </Alert>
        </Snackbar>
      ))}

    </Box>
  )
}
