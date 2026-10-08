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
import CloseIcon from '@mui/icons-material/Close'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import Visibility from '@mui/icons-material/Visibility'
import EditIcon from '@mui/icons-material/Edit'
import HomeIcon from '@mui/icons-material/Home'
import LinkIcon from '@mui/icons-material/Link'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import ImageViewer from './components/ImageViewer'
import SortableTileGrid from './components/SortableTileGrid'
import MyCollectionsShelf from './components/MyCollectionsShelf'
import ReorderSnackbar from './components/ReorderSnackbar'
import NoteDisplay from './components/NoteDisplay'
import ManageCategoriesDialog from './components/ManageCategoriesDialog'
import AdminPage from './components/AdminPage'
import AppShell from './components/AppShell'
import type { CollectionPageType, Page } from './components/AppShell'
import AddEditPersonModal from './components/AddEditPersonModal'
import CollectionsPage from './components/CollectionsPage'
import ManageCollectionsPage from './components/ManageCollectionsPage'
import AddToCollectionDialog from './components/AddToCollectionDialog'
import type { CollectionFormValues } from './components/CollectionEditDialog'
import ManagePage from './components/ManagePage'
import PeoplePage from './components/PeoplePage'
import LoginScreen from './components/LoginScreen'
import EditImageModal from './components/EditImageModal'
import ProgramManagementModal from './components/ProgramManagementModal'
import GroupManagementModal from './components/GroupManagementModal'
import NotificationMenu from './components/NotificationMenu'
import GuidePage, { type GuideDocRequest } from './components/GuidePage'
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
  updateImageInTree,
} from './treeUtils'
import UploadImageModal from './components/UploadImageModal'
import {
  collectionFullMessage,
  parseCollectionIdParam,
  parseCollectionItemParam,
} from './collectionUtils'
import type { StageAddImages } from './components/CollectionManageDialog'
import { useCollectionsData } from './useCollectionsData'
import {
  createCollectionWithImages,
  useEditableCollections,
  useVisibleCollections,
} from './useAddToCollection'
import { useFeatures } from './useFeatures'
import { useMyCollectionsShelf } from './useMyCollectionsShelf'
import { isAcceptedFile } from './fileUtils'
import { formatFileSize } from './formatUtils'
import { useAuth } from './useAuth'
import {
  fetchImage as apiFetchImage,
  fetchSourceImage,
  fetchBulkImportJob,
  listSourceImages,
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
import type { ApiImage, ApiUser } from './api'
import { mergeRenewedImageItemUrls } from './tileTokenRenewal'
import MoveCategoryDialog from './components/MoveCategoryDialog'
import MoveCollectionDialog from './components/MoveCollectionDialog'
import MoveRestrictionConfirmDialog from './components/MoveRestrictionConfirmDialog'
import FailedUploadsDialog from './components/FailedUploadsDialog'
import {
  bulkImportErrorSummary,
  FAILURE_COLLAPSE_THRESHOLD,
  MAX_REHYDRATED_FAILURES,
  useProcessingJobs,
} from './useProcessingJobs'
import type { ProcessingJob } from './useProcessingJobs'
import type { Category, Collection, Group, ImageItem } from './types'
import { MAX_DEPTH } from './types'
import AddCategoryDialog from './components/AddCategoryDialog'
import EditCategoryDialog from './components/EditCategoryDialog'
import { useColorMode } from './useColorMode'
import { useBrowseData } from './useBrowseData'
import { emitEvent, emitSessionStartedOnce, setTelemetryPage } from './observability'
import type { FrontendPage, TelemetryNavDirection } from './observability'
import { formatCategoryItemCountsForCategory } from './components/categoryOptionUtils'
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
import { useMostSevereScope, useTileOrdering } from './useTileOrdering'
import { tileOrderingCoordinator } from './tileOrdering'
import { logDrag } from './dndInstrumentation'

const COLLAPSED_BREADCRUMB_CATEGORY_DEPTH = 2

function listFailedSourceImages() {
  return listSourceImages({ status: 'failed', limit: MAX_REHYDRATED_FAILURES })
}

function getCollapsedCategoryBreadcrumb(
  path: Category[],
  visibleCategoryCount: number,
): { hiddenCategories: Category[]; visibleCategories: Category[] } {
  if (path.length <= COLLAPSED_BREADCRUMB_CATEGORY_DEPTH) {
    return { hiddenCategories: [], visibleCategories: path }
  }

  const normalizedVisibleCount = Math.min(Math.max(visibleCategoryCount, 1), path.length)

  return {
    hiddenCategories: path.slice(0, -normalizedVisibleCount),
    visibleCategories: path.slice(-normalizedVisibleCount),
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
    canViewPeople,
  } = useAuth()
  // Manage > Collections table (#1554): instructors, staff, and admins —
  // everyone except students.
  const canManageCollections = canEditContent || canViewPeople
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)

  // Deployment flags (`GET /api/features`). Collections are dark-launched:
  // the tab and `?collection=` deep links only exist once the flag is on.
  const features = useFeatures()
  const collectionsEnabled = features?.collections === true

  // `?collection={id}` implies the Collections page (deep link, #1414);
  // `&item={image_id}` is the sequence viewer position (#1416).
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(() =>
    parseCollectionIdParam(window.location.search),
  )
  const [selectedCollectionItemId, setSelectedCollectionItemId] = useState<number | null>(() =>
    parseCollectionItemParam(window.location.search),
  )
  // Whether the open collection detail was reached from a Browse tile
  // (#1529): close/back then returns to the Browse scope in `path` rather
  // than the Collections list. Deep links carrying `?cat=` start true.
  const [collectionFromBrowse, setCollectionFromBrowse] = useState<boolean>(() => {
    if (parseCollectionIdParam(window.location.search) == null) return false
    return new URLSearchParams(window.location.search).get('cat') != null
  })
  // Which Collections type page is active (#1554) — `?type=` deep links
  // restore it; bare `?page=collections` defaults to sequence.
  const [collectionPageType, setCollectionPageType] = useState<CollectionPageType>(() => {
    const t = new URLSearchParams(window.location.search).get('type')
    return t === 'synchronized' ? 'synchronized' : 'sequence'
  })
  const [page, setPage] = useState<Page>(() => {
    if (parseCollectionIdParam(window.location.search) != null) return 'collections'
    const p = new URLSearchParams(window.location.search).get('page')
    if (
      p === 'collections' ||
      p === 'manage' ||
      p === 'manage-collections' ||
      p === 'people' ||
      p === 'admin' ||
      p === 'guide'
    )
      return p
    return 'browse'
  })

  // The page actually rendered after role gating: role-gated deep links fall
  // back to browse for unauthorized roles (e.g. a student on ?page=guide), so
  // telemetry reports this rather than the raw URL param.
  const effectivePage: FrontendPage =
    (page === 'guide' || page === 'manage') && !canEditContent
      ? 'browse'
      : (page === 'admin' && !canManageUsers) || (page === 'people' && !canViewPeople)
        ? 'browse'
        : (page === 'collections' || page === 'manage-collections') &&
            features != null &&
            !features.collections
          ? 'browse'
          : page === 'manage-collections' && !canManageCollections
            ? 'browse'
            : page

  // A collections deep link on a deployment with the flag off falls back to
  // browse once the flags are known (the page renders nothing until then).
  useEffect(() => {
    if (
      features == null ||
      features.collections ||
      (page !== 'collections' && page !== 'manage-collections')
    )
      return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL state can only be corrected once the flags arrive
    setPage('browse')
    setSelectedCollectionId(null)
    setCollectionFromBrowse(false)
  }, [features, page])

  const lastEmittedPageRef = useRef<FrontendPage | null>(null)
  useEffect(() => {
    if (!currentUser) return
    if (lastEmittedPageRef.current === effectivePage) return
    const fromPage = lastEmittedPageRef.current
    lastEmittedPageRef.current = effectivePage
    emitEvent({
      event: 'navigation.page_changed',
      action: 'navigate',
      outcome: 'success',
      page: effectivePage,
      from_page: fromPage === null ? undefined : fromPage,
    })
  }, [effectivePage, currentUser])

  useEffect(() => {
    setTelemetryPage(effectivePage)
  }, [effectivePage])

  useEffect(() => {
    if (usersLoading || !currentUser) return
    emitSessionStartedOnce(effectivePage)
  }, [currentUser, effectivePage, usersLoading])

  const [path, setPath] = useState<Category[]>([])
  const pathRef = useRef(path)
  useEffect(() => {
    pathRef.current = path
  })

  const lastEmittedCategoryRef = useRef<number | null>(null)
  const lastEmittedPathIdsRef = useRef<number[]>([])
  useEffect(() => {
    if (!currentUser) return
    const categoryId = path.length > 0 ? path[path.length - 1].id : null
    if (lastEmittedCategoryRef.current === categoryId) return
    const fromCategoryId = lastEmittedCategoryRef.current
    lastEmittedCategoryRef.current = categoryId
    const prevIds = lastEmittedPathIdsRef.current
    const ids = path.map((c) => c.id)
    lastEmittedPathIdsRef.current = ids
    if (categoryId === null) return
    const isPrefix = (a: number[], b: number[]) => a.every((id, i) => b[i] === id)
    const direction: TelemetryNavDirection =
      prevIds.length < ids.length && isPrefix(prevIds, ids)
        ? 'down'
        : prevIds.length > ids.length && isPrefix(ids, prevIds)
          ? 'up'
          : 'jump'
    emitEvent({
      event: 'navigation.page_changed',
      action: 'navigate_category',
      outcome: 'success',
      page,
      category_id: categoryId,
      from_category_id: fromCategoryId ?? undefined,
      direction,
    })
  }, [path, currentUser, page])
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
  const [dragActive, setDragActive] = useState(false)
  const dragActiveRef = useRef(false)
  const browseDragActiveRef = useRef(false)
  const manageDragActiveRef = useRef(false)
  const pendingRefreshRef = useRef(false)
  const fileDragCounter = useRef(0)
  const [manageUploadOpen, setManageUploadOpen] = useState(false)
  const [addCatOpen, setAddCatOpen] = useState(false)
  const [programsPopoverAnchor, setProgramsPopoverAnchor] = useState<HTMLElement | null>(null)
  const [groupsPopoverAnchor, setGroupsPopoverAnchor] = useState<HTMLElement | null>(null)
  const [editNameCategory, setEditNameCategory] = useState<Category | null>(null)

  const [errorSnack, setErrorSnack] = useState<string | null>(null)
  const [successSnack, setSuccessSnack] = useState<{
    message: string
    trackingUrl?: string | null
    action?: { label: string; onClick: () => void }
  } | null>(null)
  const [infoSnack, setInfoSnack] = useState<string | null>(null)
  const [warnSnack, setWarnSnack] = useState<string | null>(null)
  const [moveSnack, setMoveSnack] = useState<{
    message: string
    onUndo: () => void
  } | null>(null)
  const [reorderCount, setReorderCount] = useState(0)
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
  const [changelogVersion, setChangelogVersion] = useState(0)

  // Browse data (categories, images, collections, programs, background refresh)
  const {
    categories,
    categoriesLoading,
    setCategories,
    uncategorizedImages,
    uncategorizedLoaded,
    setUncategorizedImages,
    currentCollections,
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
    liveCategoryPath,
    ancestorProgramIds,
    ancestorGroupIds,
    currentCategories,
  } = useBrowseData({ path, currentUser, dragActive, collectionsEnabled })

  // Collections data (#1414). The list fetch runs only while the tab is
  // active; the `move`/`loadCollection` actions are mounted unconditionally
  // so filed Browse collection moves (#1529) keep list/detail state in sync.
  const collectionsData = useCollectionsData({
    enabled:
      collectionsEnabled &&
      (page === 'collections' || page === 'manage-collections') &&
      currentUser != null,
    currentUser,
    selectedCollectionId,
  })

  const myCollectionsShelfEnabled =
    features?.collectionsHomeShelf === true &&
    currentUser != null &&
    page === 'browse' &&
    path.length === 0 &&
    selectedImage == null
  const myCollectionsShelf = useMyCollectionsShelf(myCollectionsShelfEnabled)

  // #1554: the page's type is the list's type filter — keep them in lockstep.
  useEffect(() => {
    if (collectionsData.filters.type !== collectionPageType) {
      collectionsData.setFilters({ ...collectionsData.filters, type: collectionPageType })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filters.type is compared, not set
  }, [collectionPageType, collectionsData.filters, collectionsData.setFilters])

  // A collection detail opened via `?collection=` self-corrects the type
  // page so Back returns to the right list. Only a detail matching the
  // *current* selection may drive this — a stale detail left over from a
  // previous selection must not override explicit type-page navigation.
  useEffect(() => {
    const t = collectionsData.detail?.type
    if (
      selectedCollectionId != null &&
      collectionsData.detail?.id === selectedCollectionId &&
      t != null &&
      t !== collectionPageType
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- detail-driven sync, guarded by selection + inequality
      setCollectionPageType(t)
    }
  }, [collectionsData.detail, collectionPageType, selectedCollectionId])

  // Navigation-safe reorder coordinator for the current Browse scope
  // (epic #975, issue #979).
  const browseScopeId = path.length > 0 ? path[path.length - 1].id : null
  const tileOrdering = useTileOrdering(browseScopeId)
  const browseTileOrderingProp = useMemo(
    () => ({
      displayOrder: tileOrdering.displayOrder,
      reportOrder: tileOrdering.reportOrder,
      claimGeneration: tileOrdering.claimGeneration,
    }),
    [tileOrdering.displayOrder, tileOrdering.reportOrder, tileOrdering.claimGeneration],
  )

  const selectedImageCategoryHidden = useMemo(
    () => getCategoryHiddenStateInTree(categories, selectedImage?.categoryId),
    [categories, selectedImage?.categoryId],
  )
  // Derive from the live ancestry, not the navigation-time `path` snapshots,
  // so a background refresh that hides or reparents an ancestor is reflected.
  const currentCategoryHiddenState = useMemo(
    () => getCategoryHiddenStateFromPath(liveCategoryPath),
    [liveCategoryPath],
  )
  const imageViewerHiddenByCategory = useMemo(
    () => selectedImageCategoryHidden.hidden || currentCategoryHiddenState.hidden,
    [selectedImageCategoryHidden.hidden, currentCategoryHiddenState.hidden],
  )
  const categoryPageHiddenSx = useMemo(
    () =>
      currentCategoryHiddenState.hidden
        ? {
            filter: 'grayscale(100%)',
          }
        : undefined,
    [currentCategoryHiddenState.hidden],
  )
  const inactiveViewerActionSx = useMemo(
    () =>
      selectedImage?.active && !imageViewerHiddenByCategory
        ? undefined
        : {
            filter: 'grayscale(100%)',
          },
    [selectedImage?.active, imageViewerHiddenByCategory],
  )
  const imageViewerCategoryHiddenSx = useMemo(
    () =>
      imageViewerHiddenByCategory
        ? {
            filter: 'grayscale(100%)',
          }
        : undefined,
    [imageViewerHiddenByCategory],
  )
  const breadcrumbProgramItems = useMemo(() => {
    const leafProgramIds = liveCategoryPath[liveCategoryPath.length - 1]?.programIds ?? []
    const leafProgramIdSet = new Set(leafProgramIds)
    return ancestorProgramIds
      .map((id) => ({ id, inherited: path.length > 0 && !leafProgramIdSet.has(id) }))
      .map((item) => {
        const program = programs.find((p) => p.id === item.id)
        return program ? { ...item, name: program.name } : null
      })
      .filter((item): item is { id: number; name: string; inherited: boolean } => item != null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [ancestorProgramIds, liveCategoryPath, path.length, programs])
  const breadcrumbGroupItems = useMemo(() => {
    const leafGroupIds = liveCategoryPath[liveCategoryPath.length - 1]?.groupIds ?? []
    const leafGroupIdSet = new Set(leafGroupIds)
    return ancestorGroupIds
      .map((id) => ({ id, inherited: path.length > 0 && !leafGroupIdSet.has(id) }))
      .map((item) => {
        const group = groups.find((g) => g.id === item.id)
        return group ? { ...item, name: group.name } : null
      })
      .filter((item): item is { id: number; name: string; inherited: boolean } => item != null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [ancestorGroupIds, groups, liveCategoryPath, path.length])
  const bumpChangelogVersion = useCallback(() => {
    setChangelogVersion((version) => version + 1)
  }, [])
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
            data-testid={`${kind}-chip`}
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
                    data-testid={`${kind}-chip`}
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
    listFailedSourceImages,
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
    rehydrateFailedJobs,
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
    collectionId: selectedCollectionId,
    collectionItemId: selectedCollectionItemId,
    collectionFromBrowse,
    collectionPageType,
    setPath,
    setSelectedImage,
  })

  // Search modal state
  const [searchOpen, setSearchOpen] = useState(false)
  // External navigation target for the guide page (e.g. from search results).
  const [guideDocRequest, setGuideDocRequest] = useState<GuideDocRequest | undefined>(undefined)
  const guideDocSeqRef = useRef(0)

  // Guide doc requests are one-shot: once we leave the guide page, drop any
  // consumed request so a remounted GuidePage initializes from ?doc= alone.
  if (page !== 'guide' && guideDocRequest !== undefined) {
    setGuideDocRequest(undefined)
  }
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
  const canvasDraftDirtyRef = useRef(false)
  const canvasSavingRef = useRef(false)
  const pendingPopStateRef = useRef<{
    page: string
    catIds: number[]
    imageId: number | null
    historyIndex?: number
  } | null>(null)
  const pendingNavigationRef = useRef<(() => void) | null>(null)
  const [discardNavigationOpen, setDiscardNavigationOpen] = useState(false)
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
    (
      popPage: string,
      catIds: number[],
      imageId: number | null,
      traversal?: { historyIndex?: number },
      poppedCollectionFromBrowse?: boolean,
    ) => {
      if (canvasSavingRef.current && traversal) {
        setErrorSnack('Please wait for the annotation save to finish.')
        return false
      }
      if (canvasDraftDirtyRef.current && traversal) {
        pendingPopStateRef.current = {
          page: popPage,
          catIds,
          imageId,
          historyIndex: traversal.historyIndex,
        }
        setDiscardNavigationOpen(true)
        return false
      }
      setCanvasEditActive(false)
      const validPage = (
        [
          'browse',
          'collections',
          'manage',
          'manage-collections',
          'people',
          'admin',
          'guide',
        ].includes(popPage)
          ? popPage
          : 'browse'
      ) as Page
      setPage(validPage)
      // The collection id lives in the URL (`?collection=`), which the browser
      // has already restored by the time popstate fires. `?item=` (sequence
      // position) and `?type=` (type page, #1554) are restored the same way.
      setSelectedCollectionId(
        validPage === 'collections' ? parseCollectionIdParam(window.location.search) : null,
      )
      if (validPage === 'collections') {
        const poppedType = new URLSearchParams(window.location.search).get('type')
        setCollectionPageType(poppedType === 'synchronized' ? 'synchronized' : 'sequence')
      }
      setSelectedCollectionItemId(
        validPage === 'collections' ? parseCollectionItemParam(window.location.search) : null,
      )

      if (validPage === 'collections') {
        // A collection entry pushed from a Browse tile restores the Browse
        // scope behind it (#1529): `?cat=` rides in the popped URL and the
        // state flag marks entries where the scope was the (param-less) root.
        const fromBrowse =
          poppedCollectionFromBrowse === true ||
          new URLSearchParams(window.location.search).get('cat') != null
        setCollectionFromBrowse(fromBrowse)
        setPath(fromBrowse ? resolveCategoryPath(categoriesRef.current, catIds) : [])
        setSelectedImage(null)
        setViewportState(undefined)
        setOverlays([])
        return true
      }

      setCollectionFromBrowse(false)
      if (validPage !== 'browse') {
        setPath([])
        setSelectedImage(null)
        setViewportState(undefined)
        setOverlays([])
        return true
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
      return true
    },
    [setViewportState, setOverlays, refreshCategories],
  )

  const { pushNavState, replayPopState } = useNavigationHistory(
    (page, catIds, imageId, traversal) =>
      handlePopState(
        page,
        catIds,
        imageId,
        traversal ? { historyIndex: traversal.toIndex } : undefined,
        traversal?.collectionFromBrowse,
      ),
  )

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

    const isRealUserSwitch = prevUser != null && prevUser.id !== currentUser?.id
    if (isRealUserSwitch) {
      lastEmittedPageRef.current = null
      lastEmittedCategoryRef.current = null
      lastEmittedPathIdsRef.current = []
      setPage('browse')
      setSelectedCollectionId(null)
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
    if (!usersLoading) {
      loadAnnouncement()
    }
  }, [
    currentUser,
    usersLoading,
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

  // Load the frontend version for every authenticated user (not just
  // admin/instructor) — students may submit feedback and the deployed
  // frontend version travels with the report even though it is not
  // displayed to them. ``/version`` is served by its own nginx and is
  // not role-guarded at the transport layer; the string carries the
  // same info as the image-tag filenames already visible in the public
  // JS bundle, so there is no new information leak.
  useEffect(() => {
    if (!currentUser) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- early-return cleanup in conditional fetch effect */
      setFrontendVersion(null)
      return
    }
    fetchFrontendVersion()
      .then((v) => {
        setFrontendVersion(v.frontend)
      })
      .catch(() => {
        // ``/version`` is only served by the chart-deployed
        // nginx; ``npm run dev`` / local Vite does not proxy
        // this path, so a rejection here is expected outside
        // Kubernetes and we fall back to ``"dev"`` at render
        // time. A failed lookup must not block feedback
        // submission — the backend falls back to its own
        // resolved frontend version.
        setFrontendVersion(null)
      })
  }, [currentUser])

  // Load deployed backend/backup component versions for the footer and
  // About dialog (admin and instructor only). These come from
  // ``/api/admin/version`` which is guarded to admin/instructor on the
  // backend; students never see those strings.
  useEffect(() => {
    if (!canEditContent) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- early-return cleanup in conditional fetch effect */
      setBackendVersion(null)
      setBackupVersion(null)
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
  }, [canEditContent])

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
    saveCanvasAnnotations,
    discardCanvasAnnotations,
    canvasDraftDirty,
    canvasSaving,
    latestVersionRef,
    latestMetadataRef,
  } = useCanvasAnnotations({
    selectedImage,
    loadCategories,
    loadUncategorizedImages,
    setErrorSnack,
  })

  useEffect(() => {
    canvasDraftDirtyRef.current = canvasDraftDirty
  }, [canvasDraftDirty])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!canvasDraftDirtyRef.current && !canvasSavingRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const runCanvasNavigation = useCallback((action: () => void) => {
    if (canvasSavingRef.current) {
      setErrorSnack('Please wait for the annotation save to finish.')
      return
    }
    if (!canvasDraftDirtyRef.current) {
      setCanvasEditActive(false)
      action()
      return
    }
    pendingNavigationRef.current = action
    setDiscardNavigationOpen(true)
  }, [])

  const confirmCanvasNavigationDiscard = useCallback(() => {
    if (canvasSavingRef.current) {
      setErrorSnack('Please wait for the annotation save to finish.')
      return
    }
    discardCanvasAnnotations()
    canvasDraftDirtyRef.current = false
    setCanvasEditActive(false)
    setDiscardNavigationOpen(false)
    const action = pendingNavigationRef.current
    pendingNavigationRef.current = null
    if (action) action()
    else {
      const popState = pendingPopStateRef.current
      pendingPopStateRef.current = null
      if (popState) {
        replayPopState(popState.historyIndex)
      }
    }
  }, [discardCanvasAnnotations, replayPopState])

  const handleSaveCanvasAnnotations = useCallback(
    async (annotations: Parameters<typeof saveCanvasAnnotations>[0]) => {
      canvasSavingRef.current = true
      try {
        return await saveCanvasAnnotations(annotations)
      } finally {
        canvasSavingRef.current = false
      }
    },
    [saveCanvasAnnotations],
  )

  const handleCanvasAnnotationsChangeForViewer = useCallback(
    (annotations: Parameters<typeof handleCanvasAnnotationsChange>[0]) => {
      canvasDraftDirtyRef.current = handleCanvasAnnotationsChange(annotations)
    },
    [handleCanvasAnnotationsChange],
  )

  const handleLogout = useCallback(() => {
    runCanvasNavigation(logout)
  }, [logout, runCanvasNavigation])

  // Build measurement config from the selected image's metadata
  // Overlay persistence (extracted to useOverlayPersistence hook)
  const {
    selectedImageMeasurement,
    handleLockOverlays,
    handleUnlockOverlays,
    handleClearOverlays,
  } = useOverlayPersistence({
    selectedImage,
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
    reorderTilesFromManage,
    manageReorderScopes,
    setManageReorderScopes,
    handleMoveCategory,
    handleRequestMoveCategory,
    handleDropImageOnCategory,
    handleDropCategoryOnCategory,
    moveCollectionOpen,
    setMoveCollectionOpen,
    movingCollection,
    setMovingCollection,
    handleRequestMoveCollection,
    handleMoveCollection,
    moveCollectionTo,
    handleDropCollectionOnCategory,
    handleDropImageOnCollection,
    handleSetCardImage,
    pendingMoveConfirm,
    confirmPendingMove,
    cancelPendingMove,
  } = useCategoryActions({
    categories,
    uncategorizedImages,
    loadCategories,
    loadUncategorizedImages,
    moveCollectionApi: collectionsEnabled ? collectionsData.move : undefined,
    addImagesToCollectionApi: collectionsEnabled
      ? (id, imageIds, role) => collectionsData.addImages(id, imageIds, role)
      : undefined,
    removeImagesFromCollectionApi: collectionsEnabled ? collectionsData.removeImages : undefined,
    currentCategories,
    currentUserRole: currentUser?.role,
    ancestorProgramIds,
    ancestorGroupIds,
    liveCategoryPath,
    path,
    setPath,
    editNameCategory,
    setErrorSnack,
    setWarningSnack: setWarnSnack,
    setInfoSnack,
    setMoveSnack,
  })

  // Coordinate a single bottom-right reorder snackbar across the browsed
  // scope and any scopes touched by the Manage Categories dialog (epic #975,
  // issue #982). A cross-parent move touches two scopes; surface whichever
  // needs attention most.
  const allReorderScopes = useMemo(
    () => (manageReorderScopes ? [browseScopeId, ...manageReorderScopes] : [browseScopeId]),
    [browseScopeId, manageReorderScopes],
  )
  const activeReorderScope = useMostSevereScope(allReorderScopes)
  const activeTileOrdering = useTileOrdering(activeReorderScope ?? null)

  // Once the Manage Categories dialog is closed and every tracked scope has
  // settled, stop tracking, so a reopened dialog starts without a stale save
  // state readout.
  useEffect(() => {
    if (dialogOpen || manageReorderScopes === null) return
    let cancelled = false
    const clearWhenSettled = () => {
      if (cancelled) return
      const settled = manageReorderScopes.every((scope) => {
        const status = tileOrderingCoordinator.getScope(scope).status
        return status === 'saved' || status === 'idle'
      })
      if (settled) setManageReorderScopes(null)
    }
    clearWhenSettled()
    const unsubscribe = tileOrderingCoordinator.subscribe(clearWhenSettled)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [dialogOpen, manageReorderScopes, setManageReorderScopes])

  const visibleJobs = getVisibleJobs({
    uploadOpen,
    manageUploadOpen,
    imageEditOpen,
    browseEditImage,
  })

  // Restore failures persisted on source-image rows so they survive a reload.
  const [failedUploadsOpen, setFailedUploadsOpen] = useState(false)
  useEffect(() => {
    if (!canEditContent || !currentUser) return
    void rehydrateFailedJobs()
    // `page` retries the fetch on the next navigation when it failed; the hook
    // itself is a no-op once a fetch has succeeded.
  }, [canEditContent, currentUser, page, rehydrateFailedJobs])

  // Only collapse failures the Failed uploads dialog can list, so a purely
  // client-side upload failure never loses its filename and reason.
  const isImageFailure = (job: ProcessingJob) =>
    job.status === 'failed' && job.kind === 'image' && job.serverFailed === true
  const imageFailureJobs = visibleJobs.filter(isImageFailure)
  const collapseImageFailures = imageFailureJobs.length >= FAILURE_COLLAPSE_THRESHOLD
  const jobSnackbars = collapseImageFailures
    ? visibleJobs.filter((job) => !isImageFailure(job))
    : visibleJobs
  const dismissImageFailures = useCallback(
    (jobs: ProcessingJob[]) => jobs.forEach((job) => dismissJob(job.id)),
    [dismissJob],
  )

  const imageBreadcrumb = useMemo(() => getCollapsedCategoryBreadcrumb(path, 1), [path])
  const categoryBreadcrumb = useMemo(() => getCollapsedCategoryBreadcrumb(path, 2), [path])
  const imageSkippedCategoryLabels = imageBreadcrumb.hiddenCategories
    .map((cat) => cat.label)
    .join(' / ')
  const categorySkippedCategoryLabels = categoryBreadcrumb.hiddenCategories
    .map((cat) => cat.label)
    .join(' / ')
  const breadcrumbItemTextSx = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: { xs: 120, sm: 180, md: 260 },
  }
  const breadcrumbCurrentTextSx = {
    ...breadcrumbItemTextSx,
    maxWidth: { xs: 140, sm: 220, md: 360 },
  }

  const handleImageClick = useCallback(
    (img: ImageItem) => {
      runCanvasNavigation(() => {
        setSelectedImage(img)
        pushNavState(
          'browse',
          pathRef.current.map((c) => c.id),
          img.id,
        )
      })
    },
    [pushNavState, runCanvasNavigation],
  )

  const handleImageRenewed = useCallback(
    (img: ApiImage) => {
      setCategories((prev) =>
        updateImageInTree(prev, img.id, (current) => mergeRenewedImageItemUrls(current, img)),
      )
      setUncategorizedImages((prev) =>
        prev.map((current) =>
          current.id === img.id ? mergeRenewedImageItemUrls(current, img) : current,
        ),
      )
      setSelectedImage((prev) =>
        prev?.id === img.id ? mergeRenewedImageItemUrls(prev, img) : prev,
      )
    },
    [setCategories, setUncategorizedImages],
  )

  const handleCategoryTileClick = useCallback(
    (cat: Category) => {
      // Rebase onto the live ancestry so a reparent since the last
      // navigation doesn't carry obsolete ancestor ids into `path`/the URL.
      const nextPath = findCategoryPath(categories, cat.id) ?? [...path, cat]
      runCanvasNavigation(() => {
        setPath(nextPath)
        pushNavState(
          'browse',
          nextPath.map((c) => c.id),
        )
      })
    },
    [categories, path, pushNavState, runCanvasNavigation],
  )

  const handleManageCategoryNavigate = useCallback(
    (categoryId: number) => {
      const nextPath = findCategoryPath(categories, categoryId)
      if (!nextPath) return

      runCanvasNavigation(() => {
        setDialogOpen(false)
        setPage('browse')
        clearImage()
        setPath(nextPath)
        pushNavState(
          'browse',
          nextPath.map((category) => category.id),
        )
      })
    },
    [categories, clearImage, pushNavState, runCanvasNavigation],
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
    logDrag('App.handleReorderComplete start', { dragActive: dragActiveRef.current })
    if (dragActiveRef.current) {
      pendingRefreshRef.current = true
      logDrag('App.handleReorderComplete deferred', { reason: 'dragActive' })
      return
    }
    pendingRefreshRef.current = false
    // Capture before fetching: a save committing while these requests are in
    // flight is newer than the fetched data and must survive the release.
    const marker = tileOrderingCoordinator.marker()
    const [catResult, imgResult] = await Promise.allSettled([
      refreshCategories(),
      refreshUncategorizedImages(),
    ])
    logDrag('App.handleReorderComplete fetched', {
      categories: catResult.status,
      images: imgResult.status,
      dragActive: dragActiveRef.current,
    })
    if (catResult.status === 'rejected') {
      setWarnSnack('Could not refresh categories after reorder.')
    }
    if (imgResult.status === 'rejected') {
      setWarnSnack('Could not refresh images after reorder.')
    }
    // If a new drag started while we were refreshing, the grid must not see
    // stale prop churn and this refresh may have been aborted, so queue a
    // re-run for after the drag ends.
    if (dragActiveRef.current) {
      pendingRefreshRef.current = true
      logDrag('App.handleReorderComplete deferred', { reason: 'dragActive after fetch' })
      return
    }
    // Once fresh authoritative data landed, drop the coordinator's cached
    // order for clean scopes so order changes made elsewhere (e.g. Manage
    // Categories) become visible immediately instead of on the next poll.
    if (catResult.status === 'fulfilled' && imgResult.status === 'fulfilled') {
      tileOrderingCoordinator.releaseCleanScopes(marker)
      logDrag('App.handleReorderComplete released clean scopes', { marker })
    }
  }, [refreshCategories, refreshUncategorizedImages])

  const handleDragActiveChange = useCallback((source: 'browse' | 'manage', active: boolean) => {
    if (source === 'browse') {
      browseDragActiveRef.current = active
    } else {
      manageDragActiveRef.current = active
    }
    const combined = browseDragActiveRef.current || manageDragActiveRef.current
    if (combined !== dragActiveRef.current) {
      setDragActive(combined)
      dragActiveRef.current = combined
    }
  }, [])

  const handleBrowseDragActiveChange = useCallback(
    (active: boolean) => handleDragActiveChange('browse', active),
    [handleDragActiveChange],
  )
  const handleManageDragActiveChange = useCallback(
    (active: boolean) => handleDragActiveChange('manage', active),
    [handleDragActiveChange],
  )

  // Run any coordinator-commit refresh that was deferred while a drag was
  // active as soon as the drag ends.
  useEffect(() => {
    if (!dragActive && pendingRefreshRef.current) {
      pendingRefreshRef.current = false
      void handleReorderComplete()
    }
  }, [dragActive, handleReorderComplete])

  // Every successful coordinator save refreshes the shared category tree and
  // uncategorized images so all consumers (e.g. Manage Categories, which can
  // write orders back) see the just-saved positions instead of stale
  // pre-save data.
  useEffect(
    () => tileOrderingCoordinator.onCommitted(() => void handleReorderComplete()),
    [handleReorderComplete],
  )

  const handleActiveAcceptServerOrder = useCallback(() => {
    if (activeReorderScope === undefined) return
    tileOrderingCoordinator.acceptServerOrder(activeReorderScope)
    void handleReorderComplete()
  }, [activeReorderScope, handleReorderComplete])

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
      runCanvasNavigation(() => {
        setPage(v)
        setSelectedCollectionId(null)
        setCollectionFromBrowse(false)
        clearImage()
        setPath([])
        pushNavState(v, [], null, v === 'collections' ? { type: collectionPageType } : undefined)
        if (v === 'browse') {
          loadCategories()
          loadUncategorizedImages()
        }
      })
    },
    [
      clearImage,
      pushNavState,
      loadCategories,
      loadUncategorizedImages,
      runCanvasNavigation,
      collectionPageType,
    ],
  )

  // Collections tab sub-menu (#1554): Sequence/Synchronized pickers. Same
  // navigation reset as a tab change plus the `type` dimension.
  const handleCollectionsTypeChange = useCallback(
    (t: CollectionPageType) => {
      runCanvasNavigation(() => {
        setPage('collections')
        setCollectionPageType(t)
        setSelectedCollectionId(null)
        setCollectionFromBrowse(false)
        clearImage()
        setPath([])
        pushNavState('collections', [], null, { type: t })
      })
    },
    [clearImage, pushNavState, runCanvasNavigation],
  )

  // Called only when already on browse (AppShell gates the click);
  // reloads data and resets to root.
  const handleHomeClick = useCallback(() => {
    runCanvasNavigation(() => {
      loadCategories()
      loadUncategorizedImages()
      clearImage()
      setPath([])
      pushNavState('browse')
    })
  }, [clearImage, pushNavState, loadCategories, loadUncategorizedImages, runCanvasNavigation])

  const handleOpenCollection = useCallback(
    (id: number, opts?: { fromBrowse?: boolean }) => {
      runCanvasNavigation(() => {
        const fromBrowse = opts?.fromBrowse === true
        setPage('collections')
        setSelectedCollectionId(id)
        setSelectedCollectionItemId(null)
        clearImage()
        // From a Browse tile the detail sits "on top of" the current scope:
        // `path` keeps the Browse location, the URL carries `?cat=` so the
        // deep link restores it, and Close returns to Browse (#1529).
        setCollectionFromBrowse(fromBrowse)
        if (!fromBrowse) setPath([])
        pushNavState(
          'collections',
          fromBrowse ? path.map((c) => c.id) : [],
          null,
          { collection: String(id) },
          { collectionFromBrowse: fromBrowse },
        )
      })
    },
    [clearImage, path, pushNavState, runCanvasNavigation],
  )

  const handleCloseCollection = useCallback(() => {
    setSelectedCollectionId(null)
    setSelectedCollectionItemId(null)
    if (collectionFromBrowse) {
      // `path` still holds the Browse scope the tile was opened from (#1529).
      setCollectionFromBrowse(false)
      setPage('browse')
      pushNavState(
        'browse',
        path.map((c) => c.id),
      )
      return
    }
    pushNavState('collections', [], null, { type: collectionPageType })
  }, [collectionFromBrowse, path, pushNavState, collectionPageType])

  // Detail-header breadcrumb (#1559): jump from the open collection to its
  // filed Browse scope (or the root for `Home`). Clears the detail like
  // `handleCloseCollection`, then navigates Browse to the target path.
  const handleNavigateBrowseFromCollection = useCallback(
    (categoryPath: Category[]) => {
      runCanvasNavigation(() => {
        setSelectedCollectionId(null)
        setSelectedCollectionItemId(null)
        setCollectionFromBrowse(false)
        setPath(categoryPath)
        setPage('browse')
        pushNavState(
          'browse',
          categoryPath.map((c) => c.id),
        )
      })
    },
    [pushNavState, runCanvasNavigation],
  )

  // Sequence viewer: `?collection={id}&item={image_id}` keeps the position
  // shareable and in history, so back steps through viewed items (#1416).
  const handleSelectCollectionItem = useCallback(
    (imageId: number) => {
      setSelectedCollectionItemId(imageId)
      if (selectedCollectionId != null) {
        pushNavState(
          'collections',
          collectionFromBrowse ? path.map((c) => c.id) : [],
          null,
          {
            collection: String(selectedCollectionId),
            item: String(imageId),
          },
          { collectionFromBrowse },
        )
      }
    },
    [collectionFromBrowse, path, pushNavState, selectedCollectionId],
  )

  // Drop an `?item=` that does not resolve to a visible member (deleted image,
  // or one hidden from this user); the URL sync effect then silently rewrites
  // the link to the bare `?collection={id}`.
  useEffect(() => {
    const detail = collectionsData.detail
    if (
      detail == null ||
      selectedCollectionItemId == null ||
      detail.images.some((img) => img.id === selectedCollectionItemId)
    ) {
      return
    }
    setSelectedCollectionItemId(null)
  }, [collectionsData.detail, selectedCollectionItemId])

  // "Add to Collection" from the image view (#1415) and from search
  // multi-select (#1418) — both paths set the target image ids before opening.
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false)
  const [addToCollectionImageIds, setAddToCollectionImageIds] = useState<number[]>([])
  const addToCollectionActive =
    collectionsEnabled &&
    addToCollectionOpen &&
    addToCollectionImageIds.length > 0 &&
    currentUser != null
  const editableCollections = useEditableCollections(addToCollectionActive)

  // Visible collections indexed by the search modal (#1418); the backend
  // list is already access-filtered for the caller.
  const searchableCollections = useVisibleCollections(
    collectionsEnabled && searchOpen && currentUser != null,
  )

  // Filed collections are provided from the category tree through
  // `useBrowseData`; the root shelf stays outside the sortable tile grid.

  // The collection Manage dialog's "+" (#1566): records the target so search
  // picks go straight into that collection instead of the picker dialog.
  // The target is set/cleared when Search *opens* — never on close — because
  // SearchModal calls onClose() before onAddImagesToCollection, so a close-
  // time clear would drop the target before the add callback reads it (#1567).
  // `stageAdd` is the dialog's staging channel — Manage commits membership
  // once on Done, so picks land in its draft rather than persisting here.
  const manageSearchTarget = useRef<{
    collection: Collection
    stageAdd: StageAddImages
  } | null>(null)
  // Manage-dialog adds open the modal with Select already on (#1567).
  const [searchInitialSelectMode, setSearchInitialSelectMode] = useState(false)
  const openSearch = useCallback(() => {
    manageSearchTarget.current = null
    setSearchInitialSelectMode(false)
    setSearchOpen(true)
  }, [])
  const requestCollectionImageSearch = useCallback(
    (collection: Collection, stageAdd: StageAddImages) => {
      manageSearchTarget.current = { collection, stageAdd }
      setSearchInitialSelectMode(true)
      setSearchOpen(true)
    },
    [],
  )

  const reportAddedToCollection = useCallback(
    (collection: { id: number; name: string }, addedCount: number) => {
      setSuccessSnack({
        message:
          addedCount === 1
            ? `Added to "${collection.name}".`
            : `Added ${addedCount} images to "${collection.name}".`,
        action: {
          label: 'View collection',
          onClick: () => {
            setSuccessSnack(null)
            handleOpenCollection(collection.id)
          },
        },
      })
    },
    [handleOpenCollection],
  )

  const handleAddToCollection = useCallback(
    async (
      collection: { id: number; name: string },
      imageIdsOverride?: number[],
    ): Promise<boolean> => {
      const imageIds = imageIdsOverride ?? addToCollectionImageIds
      if (imageIds.length === 0) return true
      try {
        // collectionsData.addImages merges the result into the open detail,
        // so a Manage dialog left open behind the search modal updates live.
        const result = await collectionsData.addImages(collection.id, imageIds)
        if (result.status === 'added') {
          reportAddedToCollection(result.collection, result.addedCount)
          return true
        }
        if (result.status === 'already') {
          setInfoSnack(`This image is already in "${result.collection.name}".`)
          return true
        }
        setErrorSnack(
          collectionFullMessage(result.collection.name, result.collection.type, 'selection'),
        )
        return false
      } catch (err) {
        setErrorSnack(userMessage(err, 'Failed to add to collection.'))
        return false
      }
    },
    [addToCollectionImageIds, collectionsData, reportAddedToCollection],
  )

  const handleSearchAddToCollection = useCallback((images: ImageItem[]) => {
    const target = manageSearchTarget.current
    manageSearchTarget.current = null
    if (target) {
      // Skip the picker — the manage dialog already identified the target.
      // Picks stage into its draft; Done persists them in the same
      // whole-replace PUT as any staged reorder/removal (#1567).
      const result = target.stageAdd(images)
      if (result.status === 'added') {
        setInfoSnack(
          result.addedCount === 1
            ? `Staged 1 image for "${target.collection.name}" — press Done to apply.`
            : `Staged ${result.addedCount} images for "${target.collection.name}" — press Done to apply.`,
        )
      } else if (result.status === 'already') {
        setInfoSnack(
          images.length === 1
            ? `This image is already in "${target.collection.name}".`
            : `Those images are already in "${target.collection.name}".`,
        )
      } else {
        setErrorSnack(
          collectionFullMessage(target.collection.name, target.collection.type, 'selection'),
        )
      }
      return
    }
    setAddToCollectionImageIds(images.map((img) => img.id))
    setAddToCollectionOpen(true)
  }, [])

  const handleCreateCollectionWithImage = useCallback(
    async (values: CollectionFormValues) => {
      const created = await createCollectionWithImages(values, addToCollectionImageIds)
      if (created.categoryId != null) refreshCategories()
      reportAddedToCollection(created, addToCollectionImageIds.length)
    },
    [addToCollectionImageIds, refreshCategories, reportAddedToCollection],
  )

  // "Open image" from the collection detail placeholder → the regular
  // `?image={id}` viewer, so back returns to the collection.
  const handleOpenCollectionImage = useCallback(
    (img: ImageItem) => {
      runCanvasNavigation(() => {
        setSelectedImage(img)
        const catPath = img.categoryId != null ? findCategoryPath(categories, img.categoryId) : null
        setPath(catPath ?? [])
        setSelectedCollectionId(null)
        setCollectionFromBrowse(false)
        setPage('browse')
        pushNavState('browse', catPath?.map((c) => c.id) ?? [], img.id)
      })
    },
    [categories, pushNavState, runCanvasNavigation],
  )

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
      canViewPeople={canViewPeople}
      collectionsEnabled={collectionsEnabled}
      collectionType={collectionPageType}
      onCollectionsTypeChange={handleCollectionsTypeChange}
      currentUser={currentUser}
      announcement={announcement}
      annMessage={annMessage}
      annEnabled={annEnabled}
      onDismissAnnouncement={dismissAnnouncement}
      profileOpen={profileOpen}
      setProfileOpen={setProfileOpen}
      avatarRef={avatarRef}
      openEditProfile={openEditProfile}
      logout={handleLogout}
      onOpenCategories={() => setDialogOpen(true)}
      onOpenPrograms={() => setProgramModalOpen(true)}
      onOpenGroups={() => setGroupModalOpen(true)}
      onOpenAnnouncement={openAnnModal}
      onSearchOpen={openSearch}
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
            changelogVersion={changelogVersion}
            onOpenGuide={() => handleTabChange('guide')}
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
          {page === 'guide' && canEditContent ? (
            <GuidePage docRequest={guideDocRequest} />
          ) : page === 'admin' && canManageUsers ? (
            <AdminPage onChangelogEntriesChanged={bumpChangelogVersion} />
          ) : page === 'collections' && !collectionsEnabled ? null : page === 'collections' ? (
            <CollectionsPage
              collectionPageType={collectionPageType}
              currentUser={currentUser}
              programs={programs}
              groups={groups}
              collections={collectionsData.collections}
              loading={collectionsData.loading}
              error={collectionsData.error}
              filters={collectionsData.filters}
              onFiltersChange={collectionsData.setFilters}
              ownerOptions={collectionsData.ownerOptions}
              selectedCollectionId={selectedCollectionId}
              detail={collectionsData.detail}
              detailLoading={collectionsData.detailLoading}
              detailError={collectionsData.detailError}
              onOpenCollection={handleOpenCollection}
              onCloseCollection={handleCloseCollection}
              onOpenImage={handleOpenCollectionImage}
              selectedCollectionItemId={selectedCollectionItemId}
              onSelectCollectionItem={handleSelectCollectionItem}
              onReorderImages={collectionsData.reorderImages}
              onCollectionImageRenewed={collectionsData.renewCollectionImage}
              onViewerError={setErrorSnack}
              onSaveViewport={collectionsData.saveViewport}
              loadCollection={collectionsData.loadCollection}
              onCreate={async (values) => {
                const created = await collectionsData.create(values)
                if (created.categoryId != null) refreshCategories()
                return created
              }}
              onUpdate={collectionsData.update}
              onDelete={collectionsData.remove}
              onSaveOwners={collectionsData.saveOwners}
              onTransfer={collectionsData.transfer}
              onMoveCollection={canEditContent ? handleRequestMoveCollection : undefined}
              onMoveCollectionToCategory={canEditContent ? moveCollectionTo : undefined}
              onRequestCollectionImageSearch={requestCollectionImageSearch}
              categories={categories}
              onAddCategory={addCategoryInline}
              onEditCategory={editCategoryInline}
              onToggleCategoryVisibility={toggleCategoryVisibility}
              onNavigateCategory={handleNavigateBrowseFromCollection}
              onToggleHidden={(collection) =>
                collectionsData.setHidden(collection.id, !collection.hidden).then((updated) => {
                  // Filed collection tiles live in the category tree, so
                  // refresh it to update the hidden marker.
                  refreshCategories()
                  return updated
                })
              }
            />
          ) : page === 'manage-collections' &&
            (!collectionsEnabled || !canManageCollections) ? null : page ===
            'manage-collections' ? (
            <ManageCollectionsPage
              categories={categories}
              programs={programs}
              groups={groups}
              currentUser={currentUser}
              onNavigateCategory={(categoryPath) => {
                runCanvasNavigation(() => {
                  setPath(categoryPath)
                  setPage('browse')
                  pushNavState(
                    'browse',
                    categoryPath.map((c) => c.id),
                  )
                })
              }}
              onMoveCollectionToCategory={canEditContent ? moveCollectionTo : undefined}
              onAddCategory={addCategoryInline}
              onEditCategory={editCategoryInline}
              onToggleCategoryVisibility={toggleCategoryVisibility}
              onOpenCollection={(id) => handleOpenCollection(id)}
              onCategoriesChanged={() => {
                // A bulk refile/delete changes tile membership in the tree.
                refreshCategories()
              }}
              onError={setErrorSnack}
            />
          ) : page === 'people' && canViewPeople ? (
            <PeoplePage
              readOnly={!canManageUsers}
              programs={programs}
              groups={groups}
              initialEditUserId={editUserId}
              onEditUserHandled={clearEditUserId}
            />
          ) : page === 'manage' && canEditContent ? (
            <ManagePage
              categories={categories}
              programs={programs}
              groups={groups}
              imagesVersion={imagesVersion}
              onDismissFailedUpload={dismissJob}
              onEditCategory={editCategoryInline}
              onToggleVisibility={toggleCategoryVisibility}
              onViewImage={(img) => {
                runCanvasNavigation(() => {
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
                })
              }}
              onNavigateCategory={(categoryPath) => {
                runCanvasNavigation(() => {
                  setPath(categoryPath)
                  setPage('browse')
                  pushNavState(
                    'browse',
                    categoryPath.map((c) => c.id),
                  )
                })
              }}
              onCategoriesChanged={() => {
                loadCategories()
                loadUncategorizedImages()
              }}
              onError={(message) => setErrorSnack(message)}
              onAddCategory={addCategoryInline}
              onReplaceImage={addProcessingJob}
              onProcessingStarted={handleProcessingStarted}
              onUploadStarted={handleUploadStarted}
              onUploadProgress={handleUploadProgress}
              onBulkImportStarted={handleBulkImportStarted}
              onUploadFailed={handleUploadFailed}
              onUploadOpenChange={setManageUploadOpen}
              onImageRenewed={handleImageRenewed}
              onSearchProgram={(programName) => {
                setSearchInitialQuery(programName)
                setSearchInitialTypeFilter('program')
                openSearch()
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
                  flexWrap: 'wrap',
                  mb: 2,
                  gap: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                    flex: '1 1 240px',
                    minWidth: 0,
                    maxWidth: '100%',
                  }}
                >
                  <MuiBreadcrumbs
                    aria-label="image breadcrumb"
                    sx={{
                      flex: '1 1 auto',
                      minWidth: 0,
                      maxWidth: '100%',
                      '& .MuiBreadcrumbs-ol': {
                        flexWrap: 'nowrap',
                      },
                      '& .MuiBreadcrumbs-li': {
                        display: 'flex',
                        alignItems: 'center',
                        minWidth: 0,
                      },
                      '& .MuiBreadcrumbs-separator': {
                        flexShrink: 0,
                      },
                    }}
                  >
                    <Link
                      component="button"
                      variant="body2"
                      underline="hover"
                      color="inherit"
                      onClick={() => {
                        runCanvasNavigation(() => {
                          clearImage()
                          setPath([])
                          pushNavState('browse')
                        })
                      }}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <HomeIcon fontSize="small" />
                      Home
                    </Link>
                    {imageBreadcrumb.hiddenCategories.length > 0 && (
                      <Tooltip title={imageSkippedCategoryLabels}>
                        <Typography
                          aria-label={`Skipped categories: ${imageSkippedCategoryLabels}`}
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            cursor: 'help',
                            flexShrink: 0,
                          }}
                        >
                          ...
                        </Typography>
                      </Tooltip>
                    )}
                    {imageBreadcrumb.visibleCategories.map((cat, i) => {
                      const pathIndex = imageBreadcrumb.hiddenCategories.length + i
                      return (
                        <Link
                          key={cat.id}
                          component="button"
                          variant="body2"
                          underline="hover"
                          color="inherit"
                          onClick={() => {
                            runCanvasNavigation(() => {
                              clearImage()
                              setPath((prev) => prev.slice(0, pathIndex + 1))
                              pushNavState(
                                'browse',
                                path.slice(0, pathIndex + 1).map((c) => c.id),
                              )
                            })
                          }}
                          sx={{ cursor: 'pointer', ...breadcrumbItemTextSx }}
                        >
                          {cat.label}
                        </Link>
                      )
                    })}
                    <Typography variant="body2" color="text.primary" sx={breadcrumbCurrentTextSx}>
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
                  {collectionsEnabled && (
                    <Tooltip
                      title={
                        canvasEditActive
                          ? 'Exit canvas edit mode first'
                          : 'Add this image to a collection'
                      }
                    >
                      <span>
                        <Button
                          variant="outlined"
                          startIcon={<PlaylistAddIcon />}
                          onClick={() => {
                            setAddToCollectionImageIds([selectedImage.id])
                            setAddToCollectionOpen(true)
                          }}
                          disabled={canvasEditActive}
                          sx={inactiveViewerActionSx}
                        >
                          Add to Collection
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </Box>
              </Box>

              <Paper elevation={3} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <ImageViewer
                  key={selectedImage.id}
                  tileSources={selectedImage.tileSources}
                  imageId={selectedImage.id}
                  categoryId={selectedImage.categoryId ?? undefined}
                  onTileSourceRenewed={handleImageRenewed}
                  onError={(message) => setErrorSnack(message)}
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
                  onCanvasAnnotationsChange={handleCanvasAnnotationsChangeForViewer}
                  onSaveCanvasAnnotations={handleSaveCanvasAnnotations}
                  canvasDraftDirty={canvasDraftDirty}
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
                    <strong>Size:</strong> {formatFileSize(selectedImage.fileSize)}
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
                  flexWrap: 'wrap',
                  mb: 2,
                  gap: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                    flex: '1 1 240px',
                    minWidth: 0,
                    maxWidth: '100%',
                  }}
                >
                  <MuiBreadcrumbs
                    aria-label="category breadcrumb"
                    sx={{
                      flex: '1 1 auto',
                      minWidth: 0,
                      maxWidth: '100%',
                      '& .MuiBreadcrumbs-ol': {
                        flexWrap: 'nowrap',
                      },
                      '& .MuiBreadcrumbs-li': {
                        display: 'flex',
                        alignItems: 'center',
                        minWidth: 0,
                      },
                      '& .MuiBreadcrumbs-separator': {
                        flexShrink: 0,
                      },
                    }}
                  >
                    <Link
                      component="button"
                      variant="body2"
                      underline="hover"
                      color={path.length === 0 ? 'text.primary' : 'inherit'}
                      onClick={() => {
                        runCanvasNavigation(() => {
                          setPath([])
                          pushNavState('browse')
                        })
                      }}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <HomeIcon fontSize="small" />
                      Home
                    </Link>
                    {categoryBreadcrumb.hiddenCategories.length > 0 && (
                      <Tooltip title={categorySkippedCategoryLabels}>
                        <Typography
                          aria-label={`Skipped categories: ${categorySkippedCategoryLabels}`}
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            cursor: 'help',
                            flexShrink: 0,
                          }}
                        >
                          ...
                        </Typography>
                      </Tooltip>
                    )}
                    {categoryBreadcrumb.visibleCategories.map((cat, i) => {
                      const pathIndex = categoryBreadcrumb.hiddenCategories.length + i
                      const isLast = pathIndex === path.length - 1
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
                            <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                              <Typography
                                variant="body2"
                                color="text.primary"
                                sx={breadcrumbCurrentTextSx}
                              >
                                {cat.label}
                              </Typography>
                              <Typography
                                component="span"
                                variant="body2"
                                color="text.secondary"
                                sx={{ ml: 0.5, fontSize: '0.9em' }}
                              >
                                ({formatCategoryItemCountsForCategory(cat)})
                              </Typography>
                            </Box>
                          ) : (
                            <Link
                              component="button"
                              variant="body2"
                              underline="hover"
                              color="inherit"
                              onClick={() => {
                                runCanvasNavigation(() => {
                                  setPath((prev) => prev.slice(0, pathIndex + 1))
                                  pushNavState(
                                    'browse',
                                    path.slice(0, pathIndex + 1).map((c) => c.id),
                                  )
                                })
                              }}
                              sx={{ cursor: 'pointer', ...breadcrumbItemTextSx }}
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
                        {liveCategoryPath.length > 0 &&
                          (() => {
                            const current = liveCategoryPath[liveCategoryPath.length - 1]
                            const isDirectlyHidden = currentCategoryHiddenState.directlyHidden
                            const inheritedHidden =
                              !isDirectlyHidden && currentCategoryHiddenState.hiddenByAncestor
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
                        {(path.length === 0 || liveCategoryPath.length > 0) &&
                          liveCategoryPath.length < MAX_DEPTH && (
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

              {page === 'browse' &&
                path.length === 0 &&
                selectedImage == null &&
                myCollectionsShelf !== null && (
                  <MyCollectionsShelf
                    collections={myCollectionsShelf}
                    categories={categories}
                    programs={programs}
                    groups={groups}
                    onOpen={(collection) =>
                      handleOpenCollection(collection.id, { fromBrowse: true })
                    }
                    onSeeAll={() => {
                      handleCollectionsTypeChange('sequence')
                      collectionsData.setFilters({
                        ...collectionsData.filters,
                        mine: true,
                        owner: 'any',
                      })
                    }}
                  />
                )}

              {/* Tile grid */}
              <SortableTileGrid
                allCategories={categories}
                currentCategories={currentCategories}
                currentImages={currentImages}
                uncategorizedImages={uncategorizedImages}
                currentCollections={currentCollections}
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
                onDropCollectionOnCategory={handleDropCollectionOnCategory}
                onDropImageOnCollection={handleDropImageOnCollection}
                onCollectionClick={(col) => handleOpenCollection(col.id, { fromBrowse: true })}
                onMoveCollection={handleRequestMoveCollection}
                onDropFilesOnCategory={handleFilesDropOnCategory}
                onImageClick={handleImageClick}
                onEditImageDetails={setBrowseEditImage}
                onImageRenewed={handleImageRenewed}
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
                tileOrdering={browseTileOrderingProp}
                onDragActiveChange={handleBrowseDragActiveChange}
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
                currentCollections.length === 0 &&
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
        onCategoryNavigate={handleManageCategoryNavigate}
        onAddCategory={addCategoryInline}
        onDeleteCategory={deleteCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
        onReorderTiles={reorderTilesFromManage}
        onReorderComplete={handleReorderComplete}
        onDragActiveChange={handleManageDragActiveChange}
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

      {/* Move collection dialog (#1529) — files a collection into a Browse
          category or removes it from Browse; admin/instructor entry points only. */}
      <MoveCollectionDialog
        open={moveCollectionOpen}
        onClose={() => {
          setMoveCollectionOpen(false)
          setMovingCollection(null)
        }}
        onMove={handleMoveCollection}
        collection={movingCollection}
        categories={categories}
        onAddCategory={addCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
        programs={programs}
        groups={groups}
      />

      {/* Move restriction confirmation dialog */}
      {pendingMoveConfirm && (
        <MoveRestrictionConfirmDialog
          open
          onConfirm={confirmPendingMove}
          onCancel={cancelPendingMove}
          categoryLabel={pendingMoveConfirm.categoryLabel}
          destinationLabel={pendingMoveConfirm.destinationLabel}
          change={pendingMoveConfirm.change}
          programs={programs}
          groups={groups}
        />
      )}

      <Dialog
        open={discardNavigationOpen}
        aria-labelledby="discard-annotation-navigation-title"
        aria-describedby="discard-annotation-navigation-description"
        onClose={() => {
          setDiscardNavigationOpen(false)
          pendingNavigationRef.current = null
          pendingPopStateRef.current = null
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id="discard-annotation-navigation-title">
          Discard annotation changes?
        </DialogTitle>
        <DialogContent id="discard-annotation-navigation-description">
          Your unsaved annotation changes will be lost.
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDiscardNavigationOpen(false)
              pendingNavigationRef.current = null
              pendingPopStateRef.current = null
            }}
          >
            Keep Editing
          </Button>
          <Button color="error" onClick={confirmCanvasNavigationDiscard} disabled={canvasSaving}>
            Discard Changes
          </Button>
        </DialogActions>
      </Dialog>

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
                runCanvasNavigation(() => {
                  setSelectedImage(browseEditImage)
                  setBrowseEditImage(null)
                  const catPath =
                    browseEditImage.categoryId != null
                      ? findCategoryPath(categories, browseEditImage.categoryId)
                      : null
                  setPath(catPath ?? [])
                  pushNavState('browse', catPath?.map((c) => c.id) ?? [], browseEditImage.id)
                })
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
        childCategories={editCategoryContext.freshChildren}
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
        onCategoryNavigate={(id) => {
          setGroupModalOpen(false)
          handleManageCategoryNavigate(id)
        }}
        canManage={canManageGroup}
        onGroupUpdated={handleGroupUpdated}
      />

      {collectionsEnabled && currentUser && (
        <AddToCollectionDialog
          open={addToCollectionOpen}
          onClose={() => setAddToCollectionOpen(false)}
          imageIds={addToCollectionImageIds}
          collections={editableCollections.collections}
          loading={editableCollections.loading}
          error={editableCollections.error}
          programs={programs}
          groups={groups}
          categories={categories}
          onAddCategory={addCategoryInline}
          onEditCategory={editCategoryInline}
          onToggleVisibility={toggleCategoryVisibility}
          onAdd={handleAddToCollection}
          onCreate={handleCreateCollectionWithImage}
        />
      )}

      {/* Report issue modal */}
      <ReportIssueModal
        open={reportIssueOpen}
        onClose={() => setReportIssueOpen(false)}
        page={page}
        frontendVersion={frontendVersion}
        onSuccess={(message, trackingUrl) => {
          setSuccessSnack({ message, trackingUrl })
        }}
        onError={(message) => setErrorSnack(message)}
      />

      {/* Search modal */}
      <SearchModal
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false)
          setSearchInitialQuery(undefined)
          setSearchInitialTypeFilter(undefined)
          setSearchInitialSelectMode(false)
          // The manage-dialog add target intentionally survives close —
          // SearchModal fires onClose() before onAddImagesToCollection (#1567),
          // and every generic opener resets it via openSearch().
        }}
        initialQuery={searchInitialQuery}
        initialTypeFilter={searchInitialTypeFilter as TypeFilter | undefined}
        initialSelectMode={searchInitialSelectMode}
        categories={categories}
        uncategorizedImages={uncategorizedImages}
        programs={programs}
        users={searchUsers}
        collections={searchableCollections.collections}
        collectionsEnabled={collectionsEnabled}
        onSelectCollection={handleOpenCollection}
        onAddImagesToCollection={handleSearchAddToCollection}
        excludeHidden={isStudent}
        suppressExtendedResults={isStudent || currentUser?.role === 'staff'}
        onSelectCategory={(catPath) => {
          runCanvasNavigation(() => {
            setPage('browse')
            setPath(catPath)
            clearImage()
            pushNavState(
              'browse',
              catPath.map((c) => c.id),
            )
          })
        }}
        onSelectImage={(image, catPath) => {
          runCanvasNavigation(() => {
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
          })
        }}
        onImageRenewed={handleImageRenewed}
        onSelectProgram={(programName) => {
          if (canEditContent) {
            runCanvasNavigation(() => {
              setManageProgramFilter(programName)
              setPage('manage')
              pushNavState('manage')
            })
          }
        }}
        onSelectUser={(userId) => {
          if (canManageUsers) {
            runCanvasNavigation(() => {
              setEditUserId(userId)
              setPage('people')
              pushNavState('people')
            })
          }
        }}
        onSelectGuide={(slug, anchor) => {
          if (!canEditContent) return
          runCanvasNavigation(() => {
            setPage('guide')
            pushNavState('guide', [], null, { doc: slug })
            guideDocSeqRef.current += 1
            setGuideDocRequest({ slug, anchor, seq: guideDocSeqRef.current })
          })
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
            xs: `${24 + (visibleJobs.length + reorderCount) * 88}px !important`,
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

      {/* Success snackbar */}
      <Snackbar
        open={successSnack !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return
          setSuccessSnack(null)
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ zIndex: 1500 }}
      >
        <Alert
          severity="success"
          onClose={() => setSuccessSnack(null)}
          variant="filled"
          action={
            successSnack?.action ? (
              <Button size="small" color="inherit" onClick={successSnack.action.onClick}>
                {successSnack.action.label}
              </Button>
            ) : successSnack?.trackingUrl ? (
              <Button
                size="small"
                color="inherit"
                href={successSnack.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Track
              </Button>
            ) : undefined
          }
        >
          {successSnack?.message}
        </Alert>
      </Snackbar>

      {/* Info snackbar (e.g. no-op "already in collection") */}
      <Snackbar
        open={infoSnack !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') return
          setInfoSnack(null)
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ zIndex: 1500 }}
      >
        <Alert severity="info" onClose={() => setInfoSnack(null)} variant="filled">
          {infoSnack}
        </Alert>
      </Snackbar>

      {/* Image upload + processing snackbars (one per job, stacked) */}
      {jobSnackbars.map((job, index) => {
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
              job.status === 'importing' ||
              job.status === 'failed'
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
                        job.failedCount
                          ? ` with ${job.failedCount} failed.${
                              bulkImportErrorSummary(job.errors)
                                ? ` ${bulkImportErrorSummary(job.errors)}`
                                : ''
                            }`
                          : ' successfully!'
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
                      onClick={() => {
                        void (async () => {
                          // Categories may not have refreshed yet; reload and search fresh data
                          let destination:
                            { image: ImageItem; categoryPath: Category[] } | undefined
                          try {
                            const freshTree = await refreshCategories()
                            const result = findImageInTree(freshTree, job.imageId!)
                            if (result) {
                              destination = {
                                image: result.image,
                                categoryPath: result.path,
                              }
                            }
                          } catch {
                            // Fall through to uncategorized check
                          }
                          if (!destination) {
                            try {
                              const freshUncat = await refreshUncategorizedImages()
                              const uncatImg = freshUncat.find((img) => img.id === job.imageId)
                              if (uncatImg) {
                                destination = {
                                  image: uncatImg,
                                  categoryPath: [],
                                }
                              }
                            } catch {
                              // Image not found
                            }
                          }
                          if (destination) {
                            const { image, categoryPath } = destination
                            runCanvasNavigation(() => {
                              setPage('browse')
                              setPath(categoryPath)
                              setSelectedImage(image)
                              setViewportState(undefined)
                              setOverlays([])
                              pushNavState(
                                'browse',
                                categoryPath.map((c) => c.id),
                                image.id,
                              )
                              dismissJob(job.id)
                            })
                          }
                        })()
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

      {/* Many simultaneous failures collapse into one summary. */}
      {collapseImageFailures && (
        <Snackbar
          open
          autoHideDuration={null}
          onClose={(_event, reason) => {
            if (reason === 'clickaway') return
            dismissImageFailures(imageFailureJobs)
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{
            zIndex: 1500,
            bottom: { xs: `${24 + jobSnackbars.length * 88}px !important` },
          }}
        >
          <Alert
            severity="error"
            variant="filled"
            sx={{ width: '100%', display: 'flex', alignItems: 'center' }}
            action={
              <>
                <Button size="small" color="inherit" onClick={() => setFailedUploadsOpen(true)}>
                  Details
                </Button>
                <IconButton
                  size="small"
                  color="inherit"
                  aria-label="Dismiss failed uploads"
                  onClick={() => dismissImageFailures(imageFailureJobs)}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </>
            }
          >
            {`${imageFailureJobs.length} uploads failed.`}
          </Alert>
        </Snackbar>
      )}

      <FailedUploadsDialog
        open={failedUploadsOpen}
        onClose={() => setFailedUploadsOpen(false)}
        onDismiss={dismissJob}
      />

      {canEditContent && (
        <ReorderSnackbar
          offsetIndex={visibleJobs.length}
          status={activeTileOrdering.status}
          serverOrderAvailable={activeTileOrdering.serverOrderAvailable}
          onRetry={activeTileOrdering.retry}
          onAcceptServerOrder={handleActiveAcceptServerOrder}
          onReapplyLocalOrder={activeTileOrdering.reapplyLocalOrder}
          otherScopesFailed={activeTileOrdering.otherScopesFailed}
          onRetryFailedScopes={activeTileOrdering.retryFailedScopes}
          onCountChange={setReorderCount}
        />
      )}
    </AppShell>
  )
}
