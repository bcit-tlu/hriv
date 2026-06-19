import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import MuiBreadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import Snackbar from '@mui/material/Snackbar'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import Visibility from '@mui/icons-material/Visibility'
import EditIcon from '@mui/icons-material/Edit'
import HomeIcon from '@mui/icons-material/Home'
import LinkIcon from '@mui/icons-material/Link'
import ImageViewer from './components/ImageViewer'
import SortableTileGrid from './components/SortableTileGrid'
import NoteDisplay from './components/NoteDisplay'
import ManageCategoriesDialog from './components/ManageCategoriesDialog'
import AdminPage from './components/AdminPage'
import AppShell from './components/AppShell'
import type { Page } from './components/AppShell'
import AddEditPersonModal from './components/AddEditPersonModal'
import ManagePage from './components/ManagePage'
import PeoplePage from './components/PeoplePage'
import LoginScreen from './components/LoginScreen'
import EditImageModal from './components/EditImageModal'
import ProgramManagementModal from './components/ProgramManagementModal'
import GroupManagementModal from './components/GroupManagementModal'
import NotificationMenu from './components/NotificationMenu'
import ReportIssueModal from './components/ReportIssueModal'
import SearchModal from './components/SearchModal'
import type { TypeFilter } from './components/SearchModal'
import {
  findImageInTree,
  findCategoryPath,
  getCategoryHiddenStateFromPath,
  getCategoryHiddenStateInTree,
  isCategoryHiddenInTree,
  resolveCategoryPath,
} from './treeUtils'
import UploadImageModal from './components/UploadImageModal'
import { isAcceptedFile } from './fileUtils'
import { useAuth } from './useAuth'
import {
  fetchImage as apiFetchImage,
  fetchSourceImage,
  fetchBulkImportJob,
  fetchVersions,
  fetchFrontendVersion,
  fetchUsers,
  createProgram,
  updateProgram,
  deleteProgram,
  createGroup,
  updateGroup,
  deleteGroup,
  userMessage,
} from './api'
import type { ApiUser } from './api'
import MoveCategoryDialog from './components/MoveCategoryDialog'
import { useProcessingJobs } from './useProcessingJobs'
import type { Category, Group, ImageItem } from './types'
import { MAX_DEPTH } from './types'
import AddCategoryDialog from './components/AddCategoryDialog'
import EditCategoryDialog from './components/EditCategoryDialog'
import { useColorMode } from './useColorMode'
import { useBrowseData } from './useBrowseData'
import { splitDirectAncestorGroupIds, splitDirectAncestorProgramIds } from './categoryUtils'
import { getInheritedRestrictionSx } from './restrictionStyles'
import { getSurfaceVariant, getVisibilityColors } from './theme'
import { useNavigationHistory, buildNavHistoryState } from './useNavigationHistory'
import { useShareableImageState } from './useShareableImageState'
import { useCanvasAnnotations } from './useCanvasAnnotations'
import { useOverlayPersistence } from './useOverlayPersistence'
import { useCategoryActions } from './useCategoryActions'
import { useImageActions } from './useImageActions'
import { useAnnouncementModal } from './useAnnouncementModal'
import { useUserProfile } from './useUserProfile'

export default function App() {
  const {
    currentUser,
    loading: usersLoading,
    login,
    logout,
    canManageUsers,
    canEditContent,
  } = useAuth()
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)

  const [page, setPage] = useState<Page>(() => {
    const p = new URLSearchParams(window.location.search).get('page')
    if (p === 'manage' || p === 'people' || p === 'admin') return p
    return 'browse'
  })
  const [path, setPath] = useState<Category[]>([])
  const pathRef = useRef(path)
  useEffect(() => {
    pathRef.current = path
  })
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const selectedImageRef = useRef<ImageItem | null>(null)
  useEffect(() => {
    selectedImageRef.current = selectedImage
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [fileDropCategoryId, setFileDropCategoryId] = useState<number | null>(null)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const fileDragCounter = useRef(0)
  const [manageUploadOpen, setManageUploadOpen] = useState(false)
  const [addCatOpen, setAddCatOpen] = useState(false)
  const [programsPopoverAnchor, setProgramsPopoverAnchor] = useState<HTMLElement | null>(null)
  const [groupsPopoverAnchor, setGroupsPopoverAnchor] = useState<HTMLElement | null>(null)
  const [editNameCategory, setEditNameCategory] = useState<Category | null>(null)

  const [errorSnack, setErrorSnack] = useState<string | null>(null)
  const [warnSnack, setWarnSnack] = useState<string | null>(null)
  const [moveSnack, setMoveSnack] = useState<{
    message: string
    onUndo: () => void
  } | null>(null)
  // Report issue modal state
  const [reportIssueOpen, setReportIssueOpen] = useState(false)

  // Component versions (admin-only, fetched lazily on mount).  Backend +
  // backup are returned by ``/api/admin/version``; frontend is served by
  // its own nginx at ``/version`` (envsubst-rendered from the Helm
  // chart's ``APP_VERSION`` env at container start — see
  // ``charts/frontend/files/default.conf.template``), so the displayed
  // string reflects the deployed image tag rather than a build-time
  // constant that would survive ``release-retag.yaml``'s digest
  // promotion into production pulls.
  const [backendVersion, setBackendVersion] = useState<string | null>(null)
  const [backupVersion, setBackupVersion] = useState<string | null>(null)
  const [frontendVersion, setFrontendVersion] = useState<string | null>(null)

  // Browse data (categories, images, programs, background refresh)
  const {
    categories,
    categoriesLoading,
    setCategories,
    uncategorizedImages,
    uncategorizedLoaded,
    setUncategorizedImages,
    programs,
    groups,
    setGroups,
    loadCategories,
    loadUncategorizedImages,
    loadPrograms,
    loadGroups,
    refreshCategories,
    refreshUncategorizedImages,
    currentImages,
    getPathRestriction,
    ancestorProgramIds,
    getPathGroupRestriction,
    ancestorGroupIds,
    currentCategories,
  } = useBrowseData({ path, currentUser })

  const selectedImageCategoryHidden = useMemo(
    () => getCategoryHiddenStateInTree(categories, selectedImage?.categoryId),
    [categories, selectedImage?.categoryId],
  )
  const currentCategoryHiddenState = useMemo(() => getCategoryHiddenStateFromPath(path), [path])
  const currentCategoryInheritedHidden =
    currentCategoryHiddenState.hiddenByAncestor && !currentCategoryHiddenState.directlyHidden
  const imageViewerHiddenByCategory = useMemo(
    () => selectedImageCategoryHidden.hidden || currentCategoryHiddenState.hidden,
    [selectedImageCategoryHidden.hidden, currentCategoryHiddenState.hidden],
  )
  const categoryPageHiddenSx = useMemo(
    () =>
      currentCategoryHiddenState.hidden
        ? {
            filter: 'grayscale(100%)',
            ...(currentCategoryInheritedHidden ? { opacity: 0.5 } : {}),
          }
        : undefined,
    [currentCategoryHiddenState.hidden, currentCategoryInheritedHidden],
  )
  const inactiveViewerActionSx = useMemo(
    () =>
      selectedImage?.active && !imageViewerHiddenByCategory
        ? undefined
        : {
            filter: 'grayscale(100%)',
            ...(imageViewerHiddenByCategory ? { opacity: 0.5 } : {}),
          },
    [selectedImage?.active, imageViewerHiddenByCategory],
  )
  const imageViewerCategoryHiddenSx = useMemo(
    () =>
      imageViewerHiddenByCategory
        ? {
            filter: 'grayscale(100%)',
            opacity: 0.5,
          }
        : undefined,
    [imageViewerHiddenByCategory],
  )
  const breadcrumbProgramItems = useMemo(() => {
    const split =
      path.length > 0
        ? splitDirectAncestorProgramIds(path)
        : { direct: ancestorProgramIds, ancestor: [] }
    return [
      ...split.direct.map((id) => ({ id, inherited: false })),
      ...split.ancestor.map((id) => ({ id, inherited: true })),
    ]
      .map((item) => {
        const program = programs.find((p) => p.id === item.id)
        return program ? { ...item, name: program.name } : null
      })
      .filter((item): item is { id: number; name: string; inherited: boolean } => item != null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [ancestorProgramIds, path, programs])
  const breadcrumbGroupItems = useMemo(() => {
    const split =
      path.length > 0
        ? splitDirectAncestorGroupIds(path)
        : { direct: ancestorGroupIds, ancestor: [] }
    return [
      ...split.direct.map((id) => ({ id, inherited: false })),
      ...split.ancestor.map((id) => ({ id, inherited: true })),
    ]
      .map((item) => {
        const group = groups.find((g) => g.id === item.id)
        return group ? { ...item, name: group.name } : null
      })
      .filter((item): item is { id: number; name: string; inherited: boolean } => item != null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [ancestorGroupIds, groups, path])
  const renderBreadcrumbChips = (
    items: Array<{ id: number; name: string; inherited: boolean }>,
    kind: 'program' | 'group',
    stateSx?: Record<string, unknown>,
  ) => {
    if (items.length === 0) return null

    const MAX_INLINE = 2
    const inline = items.slice(0, MAX_INLINE)
    const overflow = items.length - MAX_INLINE
    const color = kind === 'program' ? ('primary' as const) : ('secondary' as const)
    const anchor = kind === 'program' ? programsPopoverAnchor : groupsPopoverAnchor
    const setAnchor = kind === 'program' ? setProgramsPopoverAnchor : setGroupsPopoverAnchor

    const chipSx = (inherited: boolean) =>
      inherited ? getInheritedRestrictionSx(true, stateSx) : stateSx

    return (
      <>
        {inline.map((item) => (
          <Chip
            key={item.id}
            label={item.name}
            size="small"
            color={color}
            sx={chipSx(item.inherited)}
          />
        ))}
        {overflow > 0 && (
          <>
            <Chip
              label={`+${overflow}`}
              size="small"
              color={color}
              variant="outlined"
              onClick={(e) => setAnchor(e.currentTarget)}
              aria-label={`${overflow} more ${kind}s`}
              sx={{
                cursor: 'pointer',
                ...(stateSx ?? {}),
              }}
            />
            <Popover
              open={anchor != null}
              anchorEl={anchor}
              onClose={() => setAnchor(null)}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
              }}
            >
              <Box
                sx={{
                  p: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                }}
              >
                {items.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.name}
                    size="small"
                    color={color}
                    sx={chipSx(item.inherited)}
                  />
                ))}
              </Box>
            </Popover>
          </>
        )}
      </>
    )
  }

  // Image processing jobs (extracted to useProcessingJobs hook)
  const setImagesVersionRef = useRef<React.Dispatch<React.SetStateAction<number>>>(() => {})
  const stableSetImagesVersion = useCallback<React.Dispatch<React.SetStateAction<number>>>(
    (v) => setImagesVersionRef.current(v),
    [],
  )
  const processingJobsHook = useProcessingJobs({
    fetchSourceImage,
    fetchBulkImportJob,
    fetchImage: apiFetchImage,
    loadCategories,
    loadUncategorizedImages,
    selectedImageRef,
    setSelectedImage,
    setImagesVersion: stableSetImagesVersion,
  })
  const {
    getDisplayProgress,
    getStatusMessage,
    getUploadProgress,
    getVisibleJobs,
    getReplaceUploadProgress,
    addProcessingJob,
    handleUploadStarted,
    handleUploadProgress,
    handleUploadFailed,
    handleProcessingStarted,
    handleBulkImportStarted,
    dismissJob,
    startReplaceUpload,
    trackReplaceProgress,
    transitionReplaceToProcessing,
    failReplaceUpload,
    removeReplaceUpload,
    cancelReplace,
    resetAll: resetProcessingJobs,
  } = processingJobsHook

  // Shareable-URL state (extracted to useShareableImageState hook)
  const {
    setViewportState,
    setOverlays,
    lockEngaged,
    setLockEngaged,
    snackOpen,
    setSnackOpen,
    initialViewport,
    initialOverlays,
    handleViewportChange,
    handleOverlaysChange,
    copyShareLink,
    clearImage,
    clearPending,
  } = useShareableImageState({
    selectedImage,
    categories,
    categoriesLoading,
    uncategorizedImages,
    uncategorizedLoaded,
    page,
    path,
    setPath,
    setSelectedImage,
  })

  // Search modal state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchUsers, setSearchUsers] = useState<ApiUser[]>([])
  const [searchInitialQuery, setSearchInitialQuery] = useState<string | undefined>(undefined)
  const [searchInitialTypeFilter, setSearchInitialTypeFilter] = useState<string | undefined>(
    undefined,
  )

  // Initial program filter for ManagePage (set when navigating from search)
  const [manageProgramFilter, setManageProgramFilter] = useState<string | undefined>(undefined)
  const clearManageProgramFilter = useCallback(() => setManageProgramFilter(undefined), [])

  // Initial user to edit on PeoplePage (set when navigating from search)
  const [editUserId, setEditUserId] = useState<number | null>(null)
  const clearEditUserId = useCallback(() => setEditUserId(null), [])

  // Program management modal state (for Manage menu)
  const [programModalOpen, setProgramModalOpen] = useState(false)

  // Group management modal state (for Manage menu)
  const [groupModalOpen, setGroupModalOpen] = useState(false)

  // Canvas edit mode — tracked here so we can disable conflicting UI (e.g. Edit Details)
  const [canvasEditActive, setCanvasEditActive] = useState(false)
  const [imagesVersion, setImagesVersion] = useState(0)
  useEffect(() => {
    setImagesVersionRef.current = setImagesVersion
  }, [setImagesVersion])

  // Refs for the popstate handler (always reflect latest state)
  const categoriesRef = useRef(categories)
  useEffect(() => {
    categoriesRef.current = categories
  })
  const uncategorizedImagesRef = useRef(uncategorizedImages)
  useEffect(() => {
    uncategorizedImagesRef.current = uncategorizedImages
  })

  // Browser history integration for back/forward navigation
  const handlePopState = useCallback(
    (popPage: string, catIds: number[], imageId: number | null) => {
      const validPage = (
        ['browse', 'manage', 'people', 'admin'].includes(popPage) ? popPage : 'browse'
      ) as Page
      setPage(validPage)

      if (validPage !== 'browse') {
        setPath([])
        setSelectedImage(null)
        setViewportState(undefined)
        setOverlays([])
        return
      }

      // Force-bypass the browser HTTP cache so sort_order changes
      // (from a recent reorder) are always reflected when the user
      // navigates back to browse via the browser back/forward buttons.
      refreshCategories()

      const catPath = resolveCategoryPath(categoriesRef.current, catIds)
      setPath(catPath)

      if (imageId != null) {
        const result = findImageInTree(categoriesRef.current, imageId)
        if (result) {
          setSelectedImage(result.image)
          setPath(result.path)
        } else {
          const uncatImg = uncategorizedImagesRef.current.find((img) => img.id === imageId)
          setSelectedImage(uncatImg ?? null)
          if (uncatImg) setPath([])
        }
      } else {
        setSelectedImage(null)
      }
      setViewportState(undefined)
      setOverlays([])
    },
    [setViewportState, setOverlays, refreshCategories],
  )

  const { pushNavState } = useNavigationHistory(handlePopState)

  // Announcement modal state (load, draft, save) — extracted to useAnnouncementModal hook
  const {
    announcement,
    annMessage,
    annEnabled,
    dismissAnnouncement,
    loadAnnouncement,
    annModalOpen,
    setAnnModalOpen,
    annDraftMessage,
    setAnnDraftMessage,
    annDraftEnabled,
    setAnnDraftEnabled,
    annSaving,
    annError,
    setAnnError,
    openAnnModal,
    handleAnnSave,
  } = useAnnouncementModal(currentUser?.id)

  // User profile popover + edit modal state — extracted to useUserProfile hook
  const {
    avatarRef,
    profileOpen,
    setProfileOpen,
    editModalOpen,
    setEditModalOpen,
    currentApiUser,
    openEditProfile,
    handleSaveProfile,
  } = useUserProfile({
    currentUser,
    setErrorSnack,
    loadPrograms,
  })

  // Image edit/save/replace/delete/visibility callbacks (extracted to useImageActions hook)
  const {
    imageEditOpen,
    setImageEditOpen,
    browseEditImage,
    setBrowseEditImage,
    selectedApiImage,
    browseApiImage,
    toggleImageVisibility,
    handleSaveBrowseImage,
    handleSaveViewerImage,
    handleReplaceViewerImage,
    handleReplaceBrowseImage,
    handleDeleteViewerImage,
    handleDeleteBrowseImage,
  } = useImageActions({
    categories,
    setCategories,
    uncategorizedImages,
    setUncategorizedImages,
    selectedImage,
    setSelectedImage,
    setPath,
    loadCategories,
    loadUncategorizedImages,
    refreshCategories,
    setErrorSnack,
    clearImage,
    startReplaceUpload,
    trackReplaceProgress,
    transitionReplaceToProcessing,
    removeReplaceUpload,
    failReplaceUpload,
  })

  // Reset navigation state when user identity changes (login/logout/switch).
  // Track previous user so we only reset on actual user switches — NOT on
  // the initial null→user auth transition (session restore after refresh)
  // or the mount-time null→null render.  This preserves the URL-derived
  // page state (initialised from the query string by useState) so that
  // refreshing a non-browse page keeps the user where they were (#577).
  const prevUserRef = useRef(currentUser)
  useEffect(() => {
    const prevUser = prevUserRef.current
    prevUserRef.current = currentUser

    const isRealUserSwitch = prevUser != null && prevUser !== currentUser
    if (isRealUserSwitch) {
      setPage('browse')
      setPath([])
      setSelectedImage(null)
      setViewportState(undefined)
      setOverlays([])
      clearPending()
      window.history.replaceState(
        buildNavHistoryState('browse', [], null),
        '',
        window.location.pathname,
      )
    }

    /* eslint-disable react-hooks/set-state-in-effect -- unconditional UI cleanup on auth state change */
    setProfileOpen(false)
    setEditModalOpen(false)
    setImageEditOpen(false)
    setBrowseEditImage(null)
    setSearchOpen(false)
    setSearchUsers([])
    /* eslint-enable react-hooks/set-state-in-effect */
    resetProcessingJobs()
  }, [
    currentUser,
    resetProcessingJobs,
    setViewportState,
    setOverlays,
    clearPending,
    setImageEditOpen,
    setBrowseEditImage,
    setEditModalOpen,
    setProfileOpen,
  ])

  // Initial data load — kept in this component (rather than inside
  // useBrowseData) and declared after the reset effect above. React
  // runs effects in declaration order within a single component, so
  // the reset is guaranteed to fire before this load. This avoids
  // relying on implicit effect ordering across the hook/component
  // boundary, which would be unreliable.
  useEffect(() => {
    if (currentUser) {
      loadCategories()
      loadUncategorizedImages()
      loadPrograms()
      if (currentUser.role === 'admin' || currentUser.role === 'instructor') {
        loadGroups()
      }
    }
    loadAnnouncement()
  }, [
    currentUser,
    loadCategories,
    loadUncategorizedImages,
    loadPrograms,
    loadGroups,
    loadAnnouncement,
  ])

  // Load users for search when modal opens (admin/instructor only)
  useEffect(() => {
    if (searchOpen && canEditContent) {
      fetchUsers()
        .then(setSearchUsers)
        .catch(() => setSearchUsers([]))
    }
  }, [searchOpen, canEditContent])

  // Load deployed component versions for the footer (admin only).
  // Backend+backup come from ``/api/admin/version`` (admin-guarded on
  // the backend; non-admins never see those strings). The frontend
  // version is served by its own nginx and is not strictly admin-
  // guarded at the transport layer, but we only fetch it in the admin
  // path to match the footer's gating behaviour — the displayed
  // version string carries the same info as the image-tag filenames
  // already visible in the public JS bundle, so there is no new
  // information leak.
  useEffect(() => {
    if (!canManageUsers) {
      /* eslint-disable react-hooks/set-state-in-effect -- early-return cleanup in conditional fetch effect */
      setBackendVersion(null)
      setBackupVersion(null)
      setFrontendVersion(null)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }
    fetchVersions()
      .then((v) => {
        setBackendVersion(v.backend)
        setBackupVersion(v.backup)
      })
      .catch(() => {
        setBackendVersion(null)
        setBackupVersion(null)
      })
    fetchFrontendVersion()
      .then((v) => {
        setFrontendVersion(v.frontend)
      })
      .catch(() => {
        // ``/version`` is only served by the chart-deployed
        // nginx; ``npm run dev`` / local Vite does not proxy
        // this path, so a rejection here is expected outside
        // Kubernetes and we fall back to ``"dev"`` at render
        // time.
        setFrontendVersion(null)
      })
  }, [canManageUsers])

  // Program management handlers (for Manage menu)
  const handleAddProgram = useCallback(
    async (name: string, oidcGroup: string | null) => {
      try {
        await createProgram({ name, oidc_group: oidcGroup })
        await loadPrograms()
      } catch (err) {
        console.error('Failed to add program', err)
        setErrorSnack(userMessage(err, 'Failed to add program.'))
      }
    },
    [loadPrograms],
  )

  const handleEditProgram = useCallback(
    async (id: number, name: string, oidcGroup: string | null) => {
      try {
        await updateProgram(id, { name, oidc_group: oidcGroup })
        await loadPrograms()
      } catch (err) {
        console.error('Failed to edit program', err)
        setErrorSnack(userMessage(err, 'Failed to edit program.'))
      }
    },
    [loadPrograms],
  )

  const handleDeleteProgram = useCallback(
    async (id: number) => {
      try {
        await deleteProgram(id)
        await loadPrograms()
      } catch (err) {
        console.error('Failed to delete program', err)
        setErrorSnack(userMessage(err, 'Failed to delete program.'))
      }
    },
    [loadPrograms],
  )

  // Group management handlers (for Manage menu). Admins manage all groups;
  // instructors manage groups they co-own. The backend enforces this; the UI
  // gates the buttons via canManageGroup to avoid 403s on no-op clicks.
  const canManageGroup = useCallback(
    (group: Group): boolean => {
      if (!currentUser) return false
      if (currentUser.role === 'admin') return true
      return group.instructorIds.includes(currentUser.id)
    },
    [currentUser],
  )

  const handleAddGroup = useCallback(
    async (name: string, description: string | null) => {
      try {
        await createGroup({ name, description })
        await loadGroups()
      } catch (err) {
        console.error('Failed to add group', err)
        throw err
      }
    },
    [loadGroups],
  )

  const handleEditGroup = useCallback(
    async (id: number, name: string, description: string | null) => {
      try {
        await updateGroup(id, { name, description })
        await loadGroups()
      } catch (err) {
        console.error('Failed to edit group', err)
        throw err
      }
    },
    [loadGroups],
  )

  const handleDeleteGroup = useCallback(
    async (id: number) => {
      try {
        await deleteGroup(id)
        await loadGroups()
      } catch (err) {
        console.error('Failed to delete group', err)
        throw err
      }
    },
    [loadGroups],
  )

  // Membership mutations return the full updated group; reflect it in the
  // groups list and keep the open members dialog in sync.
  const handleGroupUpdated = useCallback(
    (updated: Group) => {
      setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))
    },
    [setGroups],
  )

  // Canvas annotations (extracted to useCanvasAnnotations hook)
  const {
    localCanvasAnnotations,
    canvasAnnotations,
    handleCanvasAnnotationsChange,
    flushCanvasAnnotations,
    latestVersionRef,
    latestMetadataRef,
  } = useCanvasAnnotations({
    selectedImage,
    loadCategories,
    loadUncategorizedImages,
    setErrorSnack,
  })

  // Build measurement config from the selected image's metadata
  // Overlay persistence (extracted to useOverlayPersistence hook)
  const {
    selectedImageMeasurement,
    handleLockOverlays,
    handleUnlockOverlays,
    handleClearOverlays,
  } = useOverlayPersistence({
    selectedImage,
    flushCanvasAnnotations,
    latestVersionRef,
    latestMetadataRef,
    loadCategories,
    loadUncategorizedImages,
    setLockEngaged,
    setErrorSnack,
  })

  const isStudent = currentUser?.role === 'student'

  // Category CRUD, reorder, move, drag-and-drop (extracted to useCategoryActions hook)
  const {
    moveCatOpen,
    setMoveCatOpen,
    movingCategory,
    setMovingCategory,
    editCategoryContext,
    addCategoryInline,
    deleteCategoryInline,
    editCategoryInline,
    toggleCategoryVisibility,
    reorderCategoriesInline,
    reorderImagesInline,
    handleMoveCategory,
    handleRequestMoveCategory,
    handleDropImageOnCategory,
    handleDropCategoryOnCategory,
    handleSetCardImage,
  } = useCategoryActions({
    categories,
    uncategorizedImages,
    loadCategories,
    loadUncategorizedImages,
    currentCategories,
    ancestorProgramIds,
    getPathRestriction,
    ancestorGroupIds,
    getPathGroupRestriction,
    path,
    setPath,
    editNameCategory,
    setErrorSnack,
    setWarningSnack: setWarnSnack,
    setMoveSnack,
  })

  const visibleJobs = getVisibleJobs({
    uploadOpen,
    manageUploadOpen,
    imageEditOpen,
    browseEditImage,
  })

  const handleImageClick = useCallback(
    (img: ImageItem) => {
      setSelectedImage(img)
      pushNavState(
        'browse',
        pathRef.current.map((c) => c.id),
        img.id,
      )
    },
    [pushNavState],
  )

  const navigateToCategory = useCallback((cat: Category) => {
    setPath((prev) => [...prev, cat])
  }, [])

  const handleCategoryTileClick = useCallback(
    (cat: Category) => {
      navigateToCategory(cat)
      pushNavState('browse', [...path.map((c) => c.id), cat.id])
    },
    [navigateToCategory, path, pushNavState],
  )

  const handleFilesDropOnGrid = useCallback((files: File[]) => {
    const accepted = files.filter(isAcceptedFile)
    const rejected = files.length - accepted.length
    if (rejected > 0) {
      setWarnSnack(
        `${rejected} file${rejected > 1 ? 's' : ''} not supported (accepted: images, .zip)`,
      )
    }
    if (accepted.length > 0) {
      setDroppedFiles(accepted)
      setUploadOpen(true)
    }
  }, [])

  const handleFilesDropOnCategory = useCallback((categoryId: number, files: File[]) => {
    const accepted = files.filter(isAcceptedFile)
    const rejected = files.length - accepted.length
    if (rejected > 0) {
      setWarnSnack(
        `${rejected} file${rejected > 1 ? 's' : ''} not supported (accepted: images, .zip)`,
      )
    }
    if (accepted.length > 0) {
      setFileDropCategoryId(categoryId)
      setDroppedFiles(accepted)
      setUploadOpen(true)
    }
  }, [])

  const handleReorderComplete = useCallback(async () => {
    const [catResult, imgResult] = await Promise.allSettled([
      refreshCategories(),
      refreshUncategorizedImages(),
    ])
    if (catResult.status === 'rejected') {
      setWarnSnack('Could not refresh categories after reorder.')
    }
    if (imgResult.status === 'rejected') {
      setWarnSnack('Could not refresh images after reorder.')
    }
  }, [refreshCategories, refreshUncategorizedImages])

  const handleReorderError = useCallback((err: unknown) => {
    setErrorSnack(userMessage(err, 'Failed to reorder tiles.'))
  }, [])

  const navigateToDepth = (depth: number) => {
    setPath((prev) => prev.slice(0, depth))
  }

  // Track when native files are being dragged over the page so we can
  // show the prominent FileDropZone at the end of the card grid.
  useEffect(() => {
    if (!canEditContent) return
    const handleDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      fileDragCounter.current += 1
      if (fileDragCounter.current === 1) setFileDragActive(true)
    }
    const handleDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      fileDragCounter.current -= 1
      if (fileDragCounter.current === 0) setFileDragActive(false)
    }
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const handleDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
      fileDragCounter.current = 0
      // Defer state reset so React's synthetic event handlers on
      // FileDropZone can fire before the component unmounts.
      requestAnimationFrame(() => setFileDragActive(false))
    }
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop, true)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop, true)
    }
  }, [canEditContent])

  const handleTabChange = useCallback(
    (v: Page) => {
      setPage(v)
      clearImage()
      setPath([])
      pushNavState(v)
      if (v === 'browse') {
        loadCategories()
        loadUncategorizedImages()
      }
    },
    [clearImage, pushNavState, loadCategories, loadUncategorizedImages],
  )

  // Called only when already on browse (AppShell gates the click);
  // reloads data and resets to root.
  const handleHomeClick = useCallback(() => {
    loadCategories()
    loadUncategorizedImages()
    clearImage()
    setPath([])
    pushNavState('browse')
  }, [clearImage, pushNavState, loadCategories, loadUncategorizedImages])

  // Show loading spinner while users are loading
  if (usersLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
      >
        <CircularProgress />
      </Box>
    )
  }

  // Show login screen when no user is authenticated
  if (!currentUser) {
    return <LoginScreen onLogin={login} announcement={announcement} />
  }

  const viewerReplaceUploadProgress = getReplaceUploadProgress('viewer')
  const browseReplaceUploadProgress = getReplaceUploadProgress('browse')

  return (
    <AppShell
      page={page}
      onTabChange={handleTabChange}
      onHomeClick={handleHomeClick}
      canEditContent={canEditContent}
      canManageUsers={canManageUsers}
      currentUser={currentUser}
      announcement={announcement}
      annMessage={annMessage}
      annEnabled={annEnabled}
      onDismissAnnouncement={dismissAnnouncement}
      profileOpen={profileOpen}
      setProfileOpen={setProfileOpen}
      avatarRef={avatarRef}
      openEditProfile={openEditProfile}
      logout={logout}
      onOpenCategories={() => setDialogOpen(true)}
      onOpenPrograms={() => setProgramModalOpen(true)}
      onOpenGroups={() => setGroupModalOpen(true)}
      onOpenAnnouncement={openAnnModal}
      onSearchOpen={() => setSearchOpen(true)}
      mode={mode}
      frontendVersion={frontendVersion}
      backendVersion={backendVersion}
      backupVersion={backupVersion}
      onReportIssue={() => setReportIssueOpen(true)}
      notificationSlot={
        currentUser.role === 'admin' || currentUser.role === 'instructor' ? (
          <NotificationMenu
            userEmail={currentUser.email}
            serverLastReadAt={
              typeof currentUser.metadataExtra?.changelog_last_read_at === 'string'
                ? currentUser.metadataExtra.changelog_last_read_at
                : null
            }
            frontendVersion={frontendVersion}
            backendVersion={backendVersion}
            backupVersion={backupVersion}
          />
        ) : null
      }
    >
      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          py: 3,
          bgcolor: page === 'people' || page === 'admin' ? getSurfaceVariant(mode) : undefined,
        }}
      >
        <Container maxWidth={false} sx={{ px: { xs: 2, sm: 3, lg: '72px', xl: '120px' } }}>
          {page === 'admin' && canManageUsers ? (
            <AdminPage />
          ) : page === 'people' && canManageUsers ? (
            <PeoplePage
              programs={programs}
              initialEditUserId={editUserId}
              onEditUserHandled={clearEditUserId}
            />
          ) : page === 'manage' && canEditContent ? (
            <ManagePage
              categories={categories}
              programs={programs}
              groups={groups}
              imagesVersion={imagesVersion}
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
                  active: img.active,
                  sortOrder: img.sort_order,
                  version: img.version,
                  createdAt: img.created_at,
                  updatedAt: img.updated_at,
                  metadataExtra: img.metadata_extra,
                  width: img.width,
                  height: img.height,
                  fileSize: img.file_size,
                })
                const catPath =
                  img.category_id != null ? findCategoryPath(categories, img.category_id) : null
                setPath(catPath ?? [])
                setPage('browse')
                pushNavState('browse', catPath?.map((c) => c.id) ?? [], img.id)
              }}
              onNavigateCategory={(categoryPath) => {
                setPath(categoryPath)
                setPage('browse')
                pushNavState(
                  'browse',
                  categoryPath.map((c) => c.id),
                )
              }}
              onCategoriesChanged={() => {
                loadCategories()
                loadUncategorizedImages()
              }}
              onAddCategory={addCategoryInline}
              onReplaceImage={addProcessingJob}
              onProcessingStarted={handleProcessingStarted}
              onUploadStarted={handleUploadStarted}
              onUploadProgress={handleUploadProgress}
              onBulkImportStarted={handleBulkImportStarted}
              onUploadFailed={handleUploadFailed}
              onUploadOpenChange={setManageUploadOpen}
              onSearchProgram={(programName) => {
                setSearchInitialQuery(programName)
                setSearchInitialTypeFilter('program')
                setSearchOpen(true)
              }}
              initialProgramFilter={manageProgramFilter}
              onInitialProgramFilterConsumed={clearManageProgramFilter}
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
                  gap: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    minWidth: 0,
                  }}
                >
                  <MuiBreadcrumbs
                    aria-label="image breadcrumb"
                    sx={{
                      minWidth: 0,
                      '& .MuiBreadcrumbs-ol': {
                        flexWrap: 'nowrap',
                      },
                      '& .MuiBreadcrumbs-li:last-of-type': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }}
                  >
                    <Link
                      component="button"
                      variant="body2"
                      underline="hover"
                      color="inherit"
                      onClick={() => {
                        clearImage()
                        navigateToDepth(0)
                        pushNavState('browse')
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
                          pushNavState(
                            'browse',
                            path.slice(0, i + 1).map((c) => c.id),
                          )
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
                  {renderBreadcrumbChips(
                    breadcrumbProgramItems,
                    'program',
                    selectedImage.active ? imageViewerCategoryHiddenSx : inactiveViewerActionSx,
                  )}
                  {renderBreadcrumbChips(
                    breadcrumbGroupItems,
                    'group',
                    selectedImage.active ? imageViewerCategoryHiddenSx : inactiveViewerActionSx,
                  )}
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    gap: 2,
                    flexShrink: 0,
                    alignItems: 'center',
                  }}
                >
                  {canEditContent &&
                    (() => {
                      const categoryHidden = imageViewerHiddenByCategory
                      if (categoryHidden) {
                        return (
                          <Button
                            variant="text"
                            startIcon={<VisibilityOff />}
                            disabled
                            aria-label="Visibility: Hidden by category"
                            sx={{
                              '&.Mui-disabled': { color: visColors.inactive },
                              ...imageViewerCategoryHiddenSx,
                            }}
                          >
                            Hidden by Category
                          </Button>
                        )
                      }
                      if (!selectedImage.active) {
                        return (
                          <Button
                            variant="text"
                            startIcon={<VisibilityOff />}
                            onClick={() => {
                              toggleImageVisibility(selectedImage.id).catch(() => {})
                            }}
                            aria-label="Visibility: Show to students"
                            sx={{ color: visColors.inactive, filter: 'grayscale(100%)' }}
                          >
                            Show Image
                          </Button>
                        )
                      }
                      return (
                        <Button
                          variant="text"
                          startIcon={<Visibility />}
                          onClick={() => {
                            toggleImageVisibility(selectedImage.id).catch(() => {})
                          }}
                          aria-label="Visibility: Hide from students"
                          color="primary"
                        >
                          Hide Image
                        </Button>
                      )
                    })()}
                  {canEditContent && (
                    <Tooltip title={canvasEditActive ? 'Exit canvas edit mode first' : ''}>
                      <span>
                        <Button
                          variant="contained"
                          startIcon={<EditIcon />}
                          onClick={() => setImageEditOpen(true)}
                          disabled={canvasEditActive}
                          sx={inactiveViewerActionSx}
                        >
                          Edit Details
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                  <Tooltip title="Copy shareable link to clipboard">
                    <Button
                      variant="outlined"
                      startIcon={<LinkIcon />}
                      onClick={copyShareLink}
                      sx={inactiveViewerActionSx}
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
                  canEditContent={canEditContent}
                  overlaysLocked={lockEngaged}
                  onLockOverlays={handleLockOverlays}
                  onUnlockOverlays={handleUnlockOverlays}
                  onClearOverlays={canEditContent ? handleClearOverlays : undefined}
                  canvasAnnotations={localCanvasAnnotations ?? canvasAnnotations}
                  onCanvasAnnotationsChange={handleCanvasAnnotationsChange}
                  onFlushCanvasAnnotations={flushCanvasAnnotations}
                  onCanvasEditModeChange={setCanvasEditActive}
                />
              </Paper>

              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Scroll or tap to zoom, and drag to pan. Buttons in the bottom left corner control
                  the view. On touch-devices, pinch-turn to rotate. The mini-map in the bottom-right
                  corner shows your current viewport.
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
                {ancestorProgramIds.length > 0 && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>
                      Program
                      {ancestorProgramIds.length > 1 ? 's' : ''}:
                    </strong>{' '}
                    {ancestorProgramIds
                      .map((pid) => programs.find((p) => p.id === pid)?.name ?? pid)
                      .join(', ')}
                  </Typography>
                )}
                {ancestorGroupIds.length > 0 && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>
                      Group
                      {ancestorGroupIds.length > 1 ? 's' : ''}:
                    </strong>{' '}
                    {ancestorGroupIds
                      .map((gid) => groups.find((g) => g.id === gid)?.name ?? gid)
                      .join(', ')}
                  </Typography>
                )}
                {selectedImage.note && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1,
                      mt: 1,
                      width: '100%',
                    }}
                  >
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      component="div"
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      <strong>Note:&nbsp;</strong>
                    </Typography>
                    <Box sx={{ flex: '1 1 60%', minWidth: 0, maxWidth: { xs: '100%', sm: '60%' } }}>
                      <NoteDisplay key={selectedImage.id} note={selectedImage.note} />
                    </Box>
                  </Box>
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
                {selectedImage.width != null && selectedImage.height != null && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>Dimensions:</strong> {selectedImage.width} &times;{' '}
                    {selectedImage.height}
                  </Typography>
                )}
                {selectedImage.fileSize != null && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>Size:</strong> {selectedImage.fileSize} MB
                  </Typography>
                )}
                {selectedImageMeasurement && (
                  <Typography variant="body2" color="text.secondary" component="span">
                    <strong>Measurement:</strong>{' '}
                    {selectedImageMeasurement.scale && selectedImageMeasurement.unit
                      ? `${selectedImageMeasurement.scale} px/${selectedImageMeasurement.unit}`
                      : selectedImageMeasurement.scale
                        ? `${selectedImageMeasurement.scale} px`
                        : (selectedImageMeasurement.unit ?? '')}
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
                  gap: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    minWidth: 0,
                  }}
                >
                  <MuiBreadcrumbs
                    aria-label="category breadcrumb"
                    sx={{
                      minWidth: 0,
                      '& .MuiBreadcrumbs-ol': {
                        flexWrap: 'nowrap',
                      },
                      '& .MuiBreadcrumbs-li:last-of-type': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }}
                  >
                    <Link
                      component="button"
                      variant="body2"
                      underline="hover"
                      color={path.length === 0 ? 'text.primary' : 'inherit'}
                      onClick={() => {
                        navigateToDepth(0)
                        pushNavState('browse')
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
                    {path.map((cat, i) => {
                      const isLast = i === path.length - 1
                      return (
                        <Box
                          key={cat.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.25,
                            minWidth: 0,
                          }}
                        >
                          {isLast ? (
                            <Typography
                              variant="body2"
                              color="text.primary"
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {cat.label}
                            </Typography>
                          ) : (
                            <Link
                              component="button"
                              variant="body2"
                              underline="hover"
                              color="inherit"
                              onClick={() => {
                                navigateToDepth(i + 1)
                                pushNavState(
                                  'browse',
                                  path.slice(0, i + 1).map((c) => c.id),
                                )
                              }}
                              sx={{
                                cursor: 'pointer',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {cat.label}
                            </Link>
                          )}
                          {isLast && canEditContent && (
                            <IconButton
                              size="small"
                              onClick={() => setEditNameCategory(cat)}
                              aria-label="Edit category"
                              sx={{
                                ml: 0.25,
                              }}
                            >
                              <EditIcon
                                sx={{
                                  fontSize: 16,
                                }}
                              />
                            </IconButton>
                          )}
                        </Box>
                      )
                    })}
                  </MuiBreadcrumbs>

                  {renderBreadcrumbChips(breadcrumbProgramItems, 'program', categoryPageHiddenSx)}
                  {renderBreadcrumbChips(breadcrumbGroupItems, 'group', categoryPageHiddenSx)}
                </Box>
                {canEditContent &&
                  (() => {
                    return (
                      <Box
                        sx={{
                          display: 'flex',
                          gap: 2,
                          flexShrink: 0,
                          alignItems: 'center',
                        }}
                      >
                        {path.length > 0 &&
                          (() => {
                            const current = path[path.length - 1]
                            const isDirectlyHidden = current.status === 'hidden'
                            const ancestorHidden = path
                              .slice(0, -1)
                              .some((p) => p.status === 'hidden')
                            const inheritedHidden = !isDirectlyHidden && ancestorHidden
                            if (inheritedHidden) {
                              return (
                                <Button
                                  variant="text"
                                  startIcon={<VisibilityOff />}
                                  disabled
                                  aria-label="Visibility: Hidden by parent category"
                                  sx={{
                                    '&.Mui-disabled': { color: visColors.inactive },
                                    ...categoryPageHiddenSx,
                                  }}
                                >
                                  Hidden by Parent
                                </Button>
                              )
                            }
                            if (isDirectlyHidden) {
                              return (
                                <Button
                                  variant="text"
                                  startIcon={<VisibilityOff />}
                                  onClick={() => toggleCategoryVisibility(current.id)}
                                  aria-label="Visibility: Show category"
                                  sx={{ color: visColors.inactive, filter: 'grayscale(100%)' }}
                                >
                                  Show Category
                                </Button>
                              )
                            }
                            return (
                              <Button
                                variant="text"
                                startIcon={<Visibility />}
                                onClick={() => toggleCategoryVisibility(current.id)}
                                aria-label="Visibility: Hide category"
                                color="primary"
                              >
                                Hide Category
                              </Button>
                            )
                          })()}
                        {path.length < MAX_DEPTH && (
                          <Button
                            variant="outlined"
                            startIcon={<CreateNewFolderIcon />}
                            onClick={() => setAddCatOpen(true)}
                            sx={categoryPageHiddenSx}
                          >
                            Add Category
                          </Button>
                        )}
                        <Button
                          variant="contained"
                          startIcon={<AddPhotoAlternateIcon />}
                          onClick={() => setUploadOpen(true)}
                          sx={categoryPageHiddenSx}
                        >
                          Add Images
                        </Button>
                      </Box>
                    )
                  })()}
              </Box>

              {/* Tile grid */}
              <SortableTileGrid
                allCategories={categories}
                currentCategories={currentCategories}
                currentImages={currentImages}
                uncategorizedImages={uncategorizedImages}
                path={path}
                canEditContent={canEditContent}
                fileDragActive={fileDragActive}
                programs={programs}
                groups={groups}
                onCategoryClick={handleCategoryTileClick}
                onMoveCategory={handleRequestMoveCategory}
                onSetCardImage={handleSetCardImage}
                onEditCategoryName={setEditNameCategory}
                onDropImageOnCategory={handleDropImageOnCategory}
                onDropCategoryOnCategory={handleDropCategoryOnCategory}
                onDropFilesOnCategory={handleFilesDropOnCategory}
                onImageClick={handleImageClick}
                onEditImageDetails={setBrowseEditImage}
                onFilesDrop={handleFilesDropOnGrid}
                onGridDragOver={
                  canEditContent
                    ? (e) => {
                        if (e.dataTransfer.types.includes('Files')) {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'copy'
                        }
                      }
                    : undefined
                }
                onGridDrop={
                  canEditContent
                    ? (e) => {
                        if (e.dataTransfer.types.includes('Files')) {
                          e.preventDefault()
                          const all = Array.from(e.dataTransfer.files)
                          handleFilesDropOnGrid(all)
                        }
                      }
                    : undefined
                }
                onReorderComplete={handleReorderComplete}
                onReorderError={handleReorderError}
              />

              {categoriesLoading ? (
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    mt: 4,
                  }}
                >
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
                    {canEditContent
                      ? 'This category is empty. Add an image or sub-category to get started.'
                      : 'This category is empty.'}
                  </Typography>
                )
              )}
            </>
          )}
        </Container>
      </Box>

      {/* Manage categories dialog */}
      <ManageCategoriesDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        categories={categories}
        uncategorizedImages={uncategorizedImages}
        onAddCategory={addCategoryInline}
        onDeleteCategory={deleteCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
        onReorderCategories={reorderCategoriesInline}
        onReorderImages={reorderImagesInline}
        onReorderComplete={handleReorderComplete}
        programs={programs}
        groups={groups}
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
        programs={programs}
        groups={groups}
      />

      {/* Image edit modal (viewer page) — no View Image button since we're already viewing */}
      <EditImageModal
        open={imageEditOpen}
        onClose={() => setImageEditOpen(false)}
        onSave={handleSaveViewerImage}
        onDelete={selectedImage ? handleDeleteViewerImage : undefined}
        onReplace={handleReplaceViewerImage}
        onCancelReplace={cancelReplace}
        replaceUploadProgress={viewerReplaceUploadProgress}
        image={selectedApiImage}
        categories={categories}
        programs={programs}
        groups={groups}
        onAddCategory={addCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
      />

      {/* Browse-view image edit modal */}
      <EditImageModal
        open={browseEditImage != null}
        onClose={() => setBrowseEditImage(null)}
        onSave={handleSaveBrowseImage}
        onDelete={browseEditImage ? handleDeleteBrowseImage : undefined}
        onReplace={handleReplaceBrowseImage}
        onCancelReplace={cancelReplace}
        replaceUploadProgress={browseReplaceUploadProgress}
        image={browseApiImage}
        categories={categories}
        programs={programs}
        groups={groups}
        onAddCategory={addCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
        onViewImage={
          browseEditImage
            ? () => {
                setSelectedImage(browseEditImage)
                setBrowseEditImage(null)
                const catPath =
                  browseEditImage.categoryId != null
                    ? findCategoryPath(categories, browseEditImage.categoryId)
                    : null
                setPath(catPath ?? [])
                pushNavState('browse', catPath?.map((c) => c.id) ?? [], browseEditImage.id)
              }
            : undefined
        }
      />

      {/* Upload image modal */}
      <UploadImageModal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false)
          setFileDropCategoryId(null)
          setDroppedFiles([])
        }}
        initialFiles={droppedFiles}
        onUploaded={() => {
          loadCategories()
          loadUncategorizedImages()
        }}
        onUploadStarted={handleUploadStarted}
        onUploadProgress={handleUploadProgress}
        onUploadFailed={handleUploadFailed}
        onProcessingStarted={handleProcessingStarted}
        onBulkImportStarted={handleBulkImportStarted}
        categoryId={fileDropCategoryId ?? (path.length > 0 ? path[path.length - 1].id : null)}
        categories={categories}
        programs={programs}
        groups={groups}
        onAddCategory={addCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
      />

      {/* Add category dialog (home tab) */}
      <AddCategoryDialog
        open={addCatOpen}
        onClose={() => setAddCatOpen(false)}
        onAdd={async (label, programIds, groupIds) => {
          await addCategoryInline(
            label,
            path.length > 0 ? path[path.length - 1].id : null,
            programIds,
            groupIds,
          )
        }}
        parentLabel={path.length > 0 ? path[path.length - 1].label : undefined}
        siblingNames={currentCategories.map((c) => c.label)}
        programs={programs}
        inheritedProgramIds={ancestorProgramIds}
        groups={groups}
        inheritedGroupIds={ancestorGroupIds}
      />

      {/* Edit category name dialog (home tab) */}
      <EditCategoryDialog
        open={editNameCategory != null}
        onClose={() => setEditNameCategory(null)}
        onSave={async (newLabel, programIds, groupIds, status) => {
          if (!editNameCategory) return
          await editCategoryInline(editNameCategory.id, newLabel, programIds, groupIds, status)
          if (path.some((p) => p.id === editNameCategory.id)) {
            setPath((prev) =>
              prev.map((p) =>
                p.id === editNameCategory.id
                  ? {
                      ...p,
                      label: newLabel,
                      programIds: programIds ?? p.programIds,
                      groupIds: groupIds ?? p.groupIds,
                      ...(status !== undefined ? { status } : {}),
                    }
                  : p,
              ),
            )
          }
        }}
        currentLabel={editCategoryContext.freshLabel}
        siblingNames={editCategoryContext.siblingNames}
        programs={programs}
        currentProgramIds={editCategoryContext.freshProgramIds}
        inheritedProgramIds={editCategoryContext.inheritedProgramIds}
        groups={groups}
        currentGroupIds={editCategoryContext.freshGroupIds}
        inheritedGroupIds={editCategoryContext.inheritedGroupIds}
        categoryStatus={editNameCategory?.status}
        ancestorHidden={isCategoryHiddenInTree(categories, editNameCategory?.parentId)}
        categoryId={editNameCategory?.id}
      />

      {/* Self-edit profile modal */}
      <AddEditPersonModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSave={handleSaveProfile}
        programs={programs}
        user={currentApiUser}
      />

      {/* Announcement modal (from Manage menu) */}
      <Dialog open={annModalOpen} onClose={() => setAnnModalOpen(false)} maxWidth="sm" fullWidth>
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

      {/* Group management modal (from Manage menu) */}
      <GroupManagementModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        groups={groups}
        onAdd={handleAddGroup}
        onEdit={handleEditGroup}
        onDelete={handleDeleteGroup}
        canManage={canManageGroup}
        onGroupUpdated={handleGroupUpdated}
      />

      {/* Report issue modal */}
      <ReportIssueModal open={reportIssueOpen} onClose={() => setReportIssueOpen(false)} />

      {/* Search modal */}
      <SearchModal
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false)
          setSearchInitialQuery(undefined)
          setSearchInitialTypeFilter(undefined)
        }}
        initialQuery={searchInitialQuery}
        initialTypeFilter={searchInitialTypeFilter as TypeFilter | undefined}
        categories={categories}
        uncategorizedImages={uncategorizedImages}
        programs={programs}
        users={searchUsers}
        isStudent={isStudent}
        onSelectCategory={(catPath) => {
          setPage('browse')
          setPath(catPath)
          clearImage()
          pushNavState(
            'browse',
            catPath.map((c) => c.id),
          )
        }}
        onSelectImage={(image, catPath) => {
          setPage('browse')
          setPath(catPath)
          setSelectedImage(image)
          setViewportState(undefined)
          setOverlays([])
          pushNavState(
            'browse',
            catPath.map((c) => c.id),
            image.id,
          )
        }}
        onSelectProgram={(programName) => {
          if (canEditContent) {
            setManageProgramFilter(programName)
            setPage('manage')
            pushNavState('manage')
          }
        }}
        onSelectUser={(userId) => {
          if (canManageUsers) {
            setEditUserId(userId)
            setPage('people')
            pushNavState('people')
          }
        }}
      />

      {/* Share-link snackbar */}
      <Snackbar
        open={snackOpen}
        autoHideDuration={3000}
        onClose={() => setSnackOpen(false)}
        message="Link copied to clipboard"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        sx={{
          zIndex: 1500,
          bottom: {
            xs: `${24 + visibleJobs.length * 88}px !important`,
          },
        }}
      />

      {/* Move-undo snackbar */}
      <Snackbar
        open={moveSnack !== null}
        autoHideDuration={8000}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return
          setMoveSnack(null)
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ zIndex: 1500 }}
      >
        <Alert
          severity="success"
          onClose={() => setMoveSnack(null)}
          variant="filled"
          action={
            <Button color="inherit" size="small" onClick={moveSnack?.onUndo} aria-label="Undo move">
              Undo
            </Button>
          }
        >
          {moveSnack?.message}
        </Alert>
      </Snackbar>

      {/* Warning snackbar (e.g. unsupported file drops) */}
      <Snackbar
        open={warnSnack !== null}
        autoHideDuration={6000}
        onClose={() => setWarnSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ zIndex: 1500 }}
      >
        <Alert severity="warning" onClose={() => setWarnSnack(null)} variant="filled">
          {warnSnack}
        </Alert>
      </Snackbar>

      {/* Error snackbar */}
      <Snackbar
        open={errorSnack !== null}
        autoHideDuration={6000}
        onClose={() => setErrorSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ zIndex: 1500 }}
      >
        <Alert severity="error" onClose={() => setErrorSnack(null)} variant="filled">
          {errorSnack}
        </Alert>
      </Snackbar>

      {/* Image upload + processing snackbars (one per job, stacked) */}
      {visibleJobs.map((job, index) => {
        const uploadFraction =
          job.status === 'uploading' && job.uploadId != null
            ? getUploadProgress(job.uploadId) || (job.uploadProgress ?? 0)
            : 0
        const displayProgress = getDisplayProgress(job)
        const statusMsg = getStatusMessage(job)
        return (
          <Snackbar
            key={job.id}
            open
            autoHideDuration={
              job.status === 'processing' ||
              job.status === 'uploading' ||
              job.status === 'importing'
                ? null
                : 6000
            }
            onClose={(_event, reason) => {
              if (reason === 'clickaway') return
              dismissJob(job.id)
            }}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            sx={{
              zIndex: 1500,
              bottom: { xs: `${24 + index * 88}px !important` },
            }}
          >
            <Alert
              severity={
                job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'info'
              }
              variant="filled"
              sx={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
              }}
              icon={
                job.status === 'processing' ||
                job.status === 'uploading' ||
                job.status === 'importing' ? (
                  <CircularProgress size={20} sx={{ color: 'inherit' }} />
                ) : undefined
              }
              onClose={() => dismissJob(job.id)}
            >
              {job.status === 'uploading' && (
                <Box sx={{ width: '100%', minWidth: 220 }}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {`Uploading: ${job.filename} — ${Math.round(uploadFraction * 100)}%`}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.round(uploadFraction * 100)}
                    sx={{
                      height: 6,
                      borderRadius: 1,
                      bgcolor: 'rgba(255,255,255,0.3)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: '#fff',
                      },
                    }}
                  />
                </Box>
              )}
              {job.status === 'processing' && (
                <Box sx={{ width: '100%', minWidth: 220 }}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {`Processing: ${job.filename} — ${displayProgress}%`}
                  </Typography>
                  {statusMsg && (
                    <Typography
                      variant="caption"
                      sx={{
                        opacity: 0.85,
                        display: 'block',
                        mb: 0.25,
                      }}
                    >
                      {statusMsg}
                    </Typography>
                  )}
                  <LinearProgress
                    variant="determinate"
                    value={displayProgress}
                    sx={{
                      height: 6,
                      borderRadius: 1,
                      bgcolor: 'rgba(255,255,255,0.3)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: '#fff',
                      },
                    }}
                  />
                </Box>
              )}
              {job.status === 'importing' && (
                <Box sx={{ width: '100%', minWidth: 220 }}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {`Importing: ${job.filename} — ${displayProgress}%`}
                  </Typography>
                  {job.totalCount != null && (
                    <Typography
                      variant="caption"
                      sx={{
                        opacity: 0.85,
                        display: 'block',
                        mb: 0.25,
                      }}
                    >
                      {`${job.completedCount ?? 0} of ${job.totalCount} completed${
                        job.failedCount ? `, ${job.failedCount} failed` : ''
                      }`}
                    </Typography>
                  )}
                  <LinearProgress
                    variant="determinate"
                    value={displayProgress}
                    sx={{
                      height: 6,
                      borderRadius: 1,
                      bgcolor: 'rgba(255,255,255,0.3)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: '#fff',
                      },
                    }}
                  />
                </Box>
              )}
              {job.status === 'completed' && (
                <>
                  {job.kind === 'bulk-import'
                    ? `"${job.filename}" import completed${
                        job.failedCount ? ` with ${job.failedCount} failed.` : ' successfully!'
                      }`
                    : `"${job.filename}" processed successfully! `}
                  {job.imageId != null && (
                    <Link
                      component="button"
                      color="inherit"
                      underline="always"
                      sx={{
                        fontWeight: 'bold',
                        verticalAlign: 'baseline',
                        cursor: 'pointer',
                        color: '#42a5f5',
                        pl: '10px',
                      }}
                      onClick={async () => {
                        // Categories may not have refreshed yet; reload and search fresh data
                        let found = false
                        try {
                          const freshTree = await refreshCategories()
                          const result = findImageInTree(freshTree, job.imageId!)
                          if (result) {
                            setPage('browse')
                            setPath(result.path)
                            setSelectedImage(result.image)
                            setViewportState(undefined)
                            setOverlays([])
                            pushNavState(
                              'browse',
                              result.path.map((c) => c.id),
                              result.image.id,
                            )
                            found = true
                          }
                        } catch {
                          // Fall through to uncategorized check
                        }
                        if (!found) {
                          try {
                            const freshUncat = await refreshUncategorizedImages()
                            const uncatImg = freshUncat.find((img) => img.id === job.imageId)
                            if (uncatImg) {
                              setPage('browse')
                              setPath([])
                              setSelectedImage(uncatImg)
                              setViewportState(undefined)
                              setOverlays([])
                              pushNavState('browse', [], uncatImg.id)
                              found = true
                            }
                          } catch {
                            // Image not found
                          }
                        }
                        if (found) {
                          dismissJob(job.id)
                        }
                      }}
                    >
                      View image
                    </Link>
                  )}
                </>
              )}
              {job.status === 'failed' &&
                (job.errorMessage ||
                  (job.kind === 'bulk-import'
                    ? `"${job.filename}" import failed.`
                    : `"${job.filename}" processing failed.`))}
            </Alert>
          </Snackbar>
        )
      })}
    </AppShell>
  )
}
