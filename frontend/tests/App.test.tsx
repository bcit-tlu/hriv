import { createRef, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../src/App'
import type { ProcessingJob } from '../src/useProcessingJobs'
import {
  createGroup,
  createProgram,
  deleteGroup,
  deleteProgram,
  fetchFrontendVersion,
  fetchUsers,
  fetchVersions,
  updateGroup,
  updateProgram,
} from '../src/api'

const apiMocks = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  fetchVersions: vi.fn(),
  fetchFrontendVersion: vi.fn(),
  createProgram: vi.fn(),
  updateProgram: vi.fn(),
  deleteProgram: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}))

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  ...apiMocks,
}))

const expectEffectiveOpacity = (element: Element | null, opacity: string) => {
  expect(element).toBeInTheDocument()
  expect(window.getComputedStyle(element as Element).opacity || '1').toBe(opacity)
}

const mockImage = {
  id: 101,
  name: 'Specimen Image',
  thumb: '/thumb.jpg',
  tileSources: '/tiles.dzi',
  categoryId: 1,
  copyright: null,
  note: null,
  active: true,
  sortOrder: 0,
  version: 1,
}

const mockSecondImage = {
  ...mockImage,
  id: 102,
  name: 'Second Specimen Image',
}

let currentImagesMock = [mockImage]

const mockPrograms = [
  { id: 1, name: 'Pathology', oidc_group: null, created_at: '', updated_at: '' },
]

const mockCurrentUser = {
  id: 1,
  name: 'Instructor',
  email: 'instructor@example.com',
  role: 'instructor' as const,
  program_ids: [1],
  program_names: ['Pathology'],
  group_ids: [10],
  group_names: ['Lab A2'],
}

let authState = {
  currentUser: mockCurrentUser,
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
  canManageUsers: false,
  canEditContent: true,
}

const mockGroups = [
  {
    id: 10,
    name: 'Lab A2',
    description: null,
    createdByUserId: 1,
    memberIds: [],
    instructorIds: [1],
    createdAt: '',
    updatedAt: '',
  },
]

const mockCategories = [
  {
    id: 1,
    label: 'Slides',
    parentId: null,
    children: [],
    images: [],
    programIds: [1],
    groupIds: [10],
    status: 'active',
    sortOrder: 0,
    version: 1,
    cardImageId: null,
    metadataExtra: null,
  },
]

type MockCategory = (typeof mockCategories)[number]

const mockDeepPath: MockCategory[] = [
  {
    ...mockCategories[0],
    id: 1,
    label: 'Human Anatomy',
    parentId: null,
    programIds: [],
    groupIds: [],
  },
  {
    ...mockCategories[0],
    id: 2,
    label: 'Head Pathologies',
    parentId: 1,
    programIds: [],
    groupIds: [],
  },
  {
    ...mockCategories[0],
    id: 3,
    label: 'Intracranial Hemorrhages ICH 1',
    parentId: 2,
  },
]

let mockInitialPath: MockCategory[] = []

/** Restore every shared mutable fixture; call from each suite's beforeEach. */
function resetFixtures() {
  // resetAllMocks drops implementations and unconsumed *Once queue entries
  // left by earlier suites, so defaults must be re-established below.
  vi.resetAllMocks()
  apiMocks.fetchUsers.mockResolvedValue([])
  apiMocks.fetchVersions.mockResolvedValue({ backend: '1.0.0', backup: '1.0.0' })
  apiMocks.fetchFrontendVersion.mockResolvedValue({ frontend: '1.0.0' })
  apiMocks.createProgram.mockResolvedValue({})
  apiMocks.updateProgram.mockResolvedValue({})
  apiMocks.deleteProgram.mockResolvedValue(undefined)
  apiMocks.createGroup.mockResolvedValue({})
  apiMocks.updateGroup.mockResolvedValue({})
  apiMocks.deleteGroup.mockResolvedValue(undefined)
  browseDataFns.refreshCategories.mockResolvedValue([])
  browseDataFns.refreshUncategorizedImages.mockResolvedValue([])
  mockImage.active = true
  mockImage.categoryId = 1
  mockImage.note = null
  mockSecondImage.active = true
  mockSecondImage.categoryId = 1
  mockSecondImage.note = null
  currentImagesMock = [mockImage]
  authState = {
    currentUser: mockCurrentUser,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    canManageUsers: false,
    canEditContent: true,
  }
  mockInitialPath = []
  visibleJobsMock = []
  processingJobsMock.rehydrateFailedJobs.mockResolvedValue(undefined)
  mockCategories.splice(0, mockCategories.length, {
    id: 1,
    label: 'Slides',
    parentId: null,
    children: [],
    images: [],
    programIds: [1],
    groupIds: [10],
    status: 'active',
    sortOrder: 0,
    version: 1,
    cardImageId: null,
    metadataExtra: null,
  })
}

const browseDataFns = {
  setGroups: vi.fn(),
  loadCategories: vi.fn(),
  loadUncategorizedImages: vi.fn(),
  loadPrograms: vi.fn(),
  loadGroups: vi.fn(),
  refreshCategories: vi.fn(),
  refreshUncategorizedImages: vi.fn(),
}

let visibleJobsMock: ProcessingJob[] = []

function makeFailedJob(id: number): ProcessingJob {
  return {
    id,
    filename: `broken-${id}.tiff`,
    status: 'failed',
    kind: 'image',
    origin: 'rehydrated',
    serverFailed: true,
    errorMessage: `Processing failed: reason ${id}`,
    serverProgress: 0,
    fileSize: 100,
    startedAt: Date.now(),
  }
}

const processingJobsMock = {
  getDisplayProgress: vi.fn(),
  getStatusMessage: vi.fn(),
  getUploadProgress: vi.fn(),
  getVisibleJobs: () => visibleJobsMock,
  rehydrateFailedJobs: vi.fn().mockResolvedValue(undefined),
  getReplaceUploadProgress: () => undefined,
  addProcessingJob: vi.fn(),
  handleUploadStarted: vi.fn(),
  handleUploadProgress: vi.fn(),
  handleUploadFailed: vi.fn(),
  handleProcessingStarted: vi.fn(),
  handleBulkImportStarted: vi.fn(),
  dismissJob: vi.fn(),
  startReplaceUpload: vi.fn(),
  trackReplaceProgress: vi.fn(),
  transitionReplaceToProcessing: vi.fn(),
  failReplaceUpload: vi.fn(),
  removeReplaceUpload: vi.fn(),
  cancelReplace: vi.fn(),
  resetAll: vi.fn(),
}

const shareableImageStateMock = {
  setViewportState: vi.fn(),
  setOverlays: vi.fn(),
  lockEngaged: false,
  setLockEngaged: vi.fn(),
  snackOpen: false,
  setSnackOpen: vi.fn(),
  initialViewport: undefined,
  initialOverlays: [],
  handleViewportChange: vi.fn(),
  handleOverlaysChange: vi.fn(),
  copyShareLink: vi.fn(),
  clearImage: vi.fn(),
  clearPending: vi.fn(),
}

const announcementModalMock = {
  announcement: '',
  annMessage: '',
  annEnabled: false,
  dismissAnnouncement: vi.fn(),
  loadAnnouncement: vi.fn(),
  annModalOpen: false,
  setAnnModalOpen: vi.fn(),
  annDraftMessage: '',
  setAnnDraftMessage: vi.fn(),
  annDraftEnabled: false,
  setAnnDraftEnabled: vi.fn(),
  annSaving: false,
  annError: null,
  setAnnError: vi.fn(),
  openAnnModal: vi.fn(),
  handleAnnSave: vi.fn(),
}

const userProfileMock = {
  avatarRef: createRef<HTMLButtonElement>(),
  profileOpen: false,
  setProfileOpen: vi.fn(),
  editModalOpen: false,
  setEditModalOpen: vi.fn(),
  currentApiUser: null,
  openEditProfile: vi.fn(),
  handleSaveProfile: vi.fn(),
}

const imageActionsMock = {
  imageEditOpen: false,
  setImageEditOpen: vi.fn(),
  browseEditImage: null,
  setBrowseEditImage: vi.fn(),
  selectedApiImage: null,
  browseApiImage: null,
  toggleImageVisibility: vi.fn(),
  handleSaveBrowseImage: vi.fn(),
  handleSaveViewerImage: vi.fn(),
  handleReplaceViewerImage: vi.fn(),
  handleReplaceBrowseImage: vi.fn(),
  handleDeleteViewerImage: vi.fn(),
  handleDeleteBrowseImage: vi.fn(),
}

const canvasAnnotationsMock = {
  localCanvasAnnotations: null,
  canvasAnnotations: [],
  handleCanvasAnnotationsChange: vi.fn(),
  saveCanvasAnnotations: vi.fn(),
  discardCanvasAnnotations: vi.fn(),
  canvasDraftDirty: false,
  latestVersionRef: { current: null },
  latestMetadataRef: { current: null },
}

const overlayPersistenceMock = {
  selectedImageMeasurement: undefined,
  handleLockOverlays: vi.fn(),
  handleUnlockOverlays: vi.fn(),
  handleClearOverlays: vi.fn(),
}

const emitEventMock = vi.fn()
const emitSessionStartedOnceMock = vi.fn()

const categoryActionsMock = {
  moveCatOpen: false,
  setMoveCatOpen: vi.fn(),
  movingCategory: null,
  setMovingCategory: vi.fn(),
  editCategoryContext: {
    freshLabel: '',
    siblingNames: [],
    freshProgramIds: [],
    inheritedProgramIds: [],
    freshGroupIds: [],
    inheritedGroupIds: [],
  },
  addCategoryInline: vi.fn(),
  deleteCategoryInline: vi.fn(),
  editCategoryInline: vi.fn(),
  toggleCategoryVisibility: vi.fn(),
  reorderTilesFromManage: vi.fn(),
  manageReorderScopes: null,
  setManageReorderScopes: vi.fn(),
  handleMoveCategory: vi.fn(),
  handleRequestMoveCategory: vi.fn(),
  handleDropImageOnCategory: vi.fn(),
  handleDropCategoryOnCategory: vi.fn(),
  handleSetCardImage: vi.fn(),
}

vi.mock('../src/components/AppShell', () => ({
  default: ({
    children,
    onTabChange,
    onHomeClick,
    onSearchOpen,
    onOpenPrograms,
    onOpenGroups,
    logout,
    frontendVersion,
    backendVersion,
  }: {
    children: ReactNode
    onTabChange: (v: string) => void
    onHomeClick: () => void
    onSearchOpen: () => void
    onOpenPrograms: () => void
    onOpenGroups: () => void
    logout: () => void
    frontendVersion: string | null
    backendVersion: string | null
  }) => (
    <div>
      <div>
        versions: {String(frontendVersion)}/{String(backendVersion)}
      </div>
      <button type="button" onClick={() => onTabChange('admin')}>
        Shell tab admin
      </button>
      <button type="button" onClick={() => onTabChange('browse')}>
        Shell tab browse
      </button>
      <button type="button" onClick={onHomeClick}>
        Shell home
      </button>
      <button type="button" onClick={onSearchOpen}>
        Shell search
      </button>
      <button type="button" onClick={onOpenPrograms}>
        Shell programs
      </button>
      <button type="button" onClick={onOpenGroups}>
        Shell groups
      </button>
      <button type="button" onClick={logout}>
        Shell logout
      </button>
      {children}
    </div>
  ),
}))

vi.mock('../src/components/SortableTileGrid', () => ({
  default: ({
    currentImages,
    currentCategories,
    onImageClick,
    onCategoryClick,
    onFilesDrop,
    fileDragActive,
    onDragActiveChange,
  }: {
    currentImages: (typeof mockImage)[]
    currentCategories: typeof mockCategories
    onImageClick: (img: typeof mockImage) => void
    onCategoryClick: (category: (typeof mockCategories)[number]) => void
    onFilesDrop: (files: File[]) => void
    fileDragActive: boolean
    onDragActiveChange?: (active: boolean) => void
  }) => (
    <>
      {fileDragActive && <div>File drag active</div>}
      <button
        type="button"
        onClick={() =>
          onFilesDrop([
            new File([''], 'slide.png', { type: 'image/png' }),
            new File([''], 'notes.txt', { type: 'text/plain' }),
          ])
        }
      >
        Drop files on grid
      </button>
      <button type="button" onClick={() => onDragActiveChange?.(true)}>
        Start browse drag
      </button>
      <button type="button" onClick={() => onDragActiveChange?.(false)}>
        End browse drag
      </button>
      {currentImages.map((image, index) => (
        <button key={image.id} type="button" onClick={() => onImageClick(image)}>
          {index === 0 ? 'Open image' : `Open image ${image.id}`}
        </button>
      ))}
      {currentCategories[0] && (
        <button type="button" onClick={() => onCategoryClick(currentCategories[0])}>
          Open category
        </button>
      )}
      {currentCategories[0]?.children[0] && (
        <button type="button" onClick={() => onCategoryClick(currentCategories[0].children[0])}>
          Open child category
        </button>
      )}
    </>
  ),
}))

vi.mock('../src/components/ImageViewer', () => ({
  default: () => <div>Image Viewer</div>,
}))

vi.mock('../src/components/ManageCategoriesDialog', () => ({
  default: ({
    onReorderComplete,
    onDragActiveChange,
  }: {
    onReorderComplete: () => Promise<void>
    onDragActiveChange?: (active: boolean) => void
  }) => (
    <>
      <button type="button" onClick={() => void onReorderComplete()}>
        Manage reorder complete
      </button>
      <button type="button" onClick={() => onDragActiveChange?.(true)}>
        Start manage drag
      </button>
      <button type="button" onClick={() => onDragActiveChange?.(false)}>
        End manage drag
      </button>
    </>
  ),
}))
vi.mock('../src/components/AdminPage', () => ({ default: () => null }))
vi.mock('../src/components/PeoplePage', () => ({ default: () => null }))
vi.mock('../src/components/ManagePage', () => ({ default: () => null }))
vi.mock('../src/components/LoginScreen', () => ({ default: () => null }))
vi.mock('../src/components/EditImageModal', () => ({ default: () => null }))
vi.mock('../src/components/ProgramManagementModal', () => ({
  default: ({
    open,
    onAdd,
    onEdit,
    onDelete,
  }: {
    open: boolean
    onAdd: (name: string, oidcGroup: string | null) => Promise<void>
    onEdit: (id: number, name: string, oidcGroup: string | null) => Promise<void>
    onDelete: (id: number) => Promise<void>
  }) =>
    open ? (
      <div>
        <button type="button" onClick={() => void onAdd('New Program', null)}>
          Modal add program
        </button>
        <button type="button" onClick={() => void onEdit(1, 'Renamed Program', 'oidc-grp')}>
          Modal edit program
        </button>
        <button type="button" onClick={() => void onDelete(1)}>
          Modal delete program
        </button>
      </div>
    ) : null,
}))
vi.mock('../src/components/GroupManagementModal', () => ({
  default: ({
    open,
    onAdd,
    onEdit,
    onDelete,
  }: {
    open: boolean
    onAdd: (name: string, description: string | null) => Promise<void>
    onEdit: (id: number, name: string, description: string | null) => Promise<void>
    onDelete: (id: number) => Promise<void>
  }) =>
    open ? (
      <div>
        {/* Group handlers rethrow (the real modal surfaces the error); swallow here */}
        <button type="button" onClick={() => void onAdd('New Group', null).catch(() => {})}>
          Modal add group
        </button>
        <button
          type="button"
          onClick={() => void onEdit(10, 'Renamed Group', 'desc').catch(() => {})}
        >
          Modal edit group
        </button>
        <button type="button" onClick={() => void onDelete(10).catch(() => {})}>
          Modal delete group
        </button>
      </div>
    ) : null,
}))
vi.mock('../src/components/ReportIssueModal', () => ({ default: () => null }))
vi.mock('../src/observability', () => ({
  emitEvent: (...args: unknown[]) => emitEventMock(...args),
  emitSessionStartedOnce: (...args: unknown[]) => emitSessionStartedOnceMock(...args),
}))
vi.mock('../src/components/SearchModal', () => ({
  default: ({
    open,
    users,
    onClose,
    onSelectImage,
  }: {
    open: boolean
    users: unknown[]
    onClose: () => void
    onSelectImage: (image: typeof mockSecondImage, categoryPath: typeof mockCategories) => void
  }) => (
    <>
      {open && <div>search users: {users.length}</div>}
      <button type="button" onClick={onClose}>
        Close search
      </button>
      <button type="button" onClick={() => onSelectImage(mockSecondImage, mockCategories)}>
        Select second image from search
      </button>
    </>
  ),
}))
vi.mock('../src/components/UploadImageModal', () => ({ default: () => null }))
vi.mock('../src/components/MoveCategoryDialog', () => ({ default: () => null }))
vi.mock('../src/components/AddCategoryDialog', () => ({ default: () => null }))
vi.mock('../src/components/EditCategoryDialog', () => ({ default: () => null }))
vi.mock('../src/components/AddEditPersonModal', () => ({ default: () => null }))

vi.mock('../src/useAuth', () => ({
  useAuth: () => authState,
}))

vi.mock('../src/useColorMode', () => ({
  useColorMode: () => ({ mode: 'light' }),
}))

vi.mock('../src/useBrowseData', () => ({
  useBrowseData: () => ({
    categories: mockCategories,
    categoriesLoading: false,
    setCategories: vi.fn(),
    uncategorizedImages: [],
    uncategorizedLoaded: true,
    setUncategorizedImages: vi.fn(),
    programs: mockPrograms,
    groups: mockGroups,
    ...browseDataFns,
    currentImages: currentImagesMock,
    getPathRestriction: () => [1],
    ancestorProgramIds: [1],
    getPathGroupRestriction: () => [10],
    ancestorGroupIds: [10],
    currentCategories: mockCategories,
  }),
}))

vi.mock('../src/useNavigationHistory', () => ({
  useNavigationHistory: () => ({ pushNavState: vi.fn() }),
  buildNavHistoryState: vi.fn(),
}))

vi.mock('../src/useProcessingJobs', () => ({
  useProcessingJobs: () => processingJobsMock,
  MAX_REHYDRATED_FAILURES: 20,
  FAILURE_COLLAPSE_THRESHOLD: 5,
}))

vi.mock('../src/useShareableImageState', () => ({
  useShareableImageState: ({ setPath }: { setPath: (path: MockCategory[]) => void }) => {
    useEffect(() => {
      if (mockInitialPath.length > 0) {
        setPath(mockInitialPath)
      }
    }, [setPath])
    return shareableImageStateMock
  },
}))

vi.mock('../src/useAnnouncementModal', () => ({
  useAnnouncementModal: () => announcementModalMock,
}))

vi.mock('../src/useUserProfile', () => ({
  useUserProfile: () => userProfileMock,
}))

vi.mock('../src/useImageActions', () => ({
  useImageActions: () => imageActionsMock,
}))

vi.mock('../src/useCanvasAnnotations', () => ({
  useCanvasAnnotations: () => canvasAnnotationsMock,
}))

vi.mock('../src/useOverlayPersistence', () => ({
  useOverlayPersistence: () => overlayPersistenceMock,
}))

vi.mock('../src/useCategoryActions', () => ({
  useCategoryActions: () => categoryActionsMock,
}))

describe('App breadcrumbs', () => {
  beforeEach(() => {
    resetFixtures()
    canvasAnnotationsMock.canvasDraftDirty = false
    canvasAnnotationsMock.discardCanvasAnnotations.mockReset()
  })

  it('confirms before logging out with a dirty canvas draft', () => {
    canvasAnnotationsMock.canvasDraftDirty = true
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Shell logout', hidden: true }))
    expect(screen.getByText('Discard annotation changes?')).toBeInTheDocument()
    expect(authState.logout).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }))
    expect(authState.logout).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Shell logout', hidden: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }))
    expect(canvasAnnotationsMock.discardCanvasAnnotations).toHaveBeenCalledOnce()
    expect(authState.logout).toHaveBeenCalledOnce()
  })

  it('renders program and group chips in both browse and image breadcrumb rows', () => {
    render(<App />)

    const categoryBreadcrumb = screen.getByLabelText('category breadcrumb').closest('div')
    expect(categoryBreadcrumb).not.toBeNull()
    expect(within(categoryBreadcrumb as HTMLElement).getByText('Pathology')).toBeInTheDocument()
    expect(within(categoryBreadcrumb as HTMLElement).getByText('Lab A2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    const imageBreadcrumb = screen.getByLabelText('image breadcrumb').closest('div')
    expect(imageBreadcrumb).not.toBeNull()
    expect(within(imageBreadcrumb as HTMLElement).getByText('Pathology')).toBeInTheDocument()
    expect(within(imageBreadcrumb as HTMLElement).getByText('Lab A2')).toBeInTheDocument()
  })

  it('desaturates program and group chips in the image breadcrumb when the image is inactive', () => {
    mockImage.active = false

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    const imageBreadcrumb = screen.getByLabelText('image breadcrumb').closest('div')
    expect(imageBreadcrumb).not.toBeNull()

    const programChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Pathology')
      .closest('[data-testid="program-chip"]')
    const groupChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Lab A2')
      .closest('[data-testid="group-chip"]')
    const editButton = screen.getByRole('button', { name: 'Edit Details' })
    const shareButton = screen.getByText('Share View').closest('button')

    expect(programChip).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(groupChip).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(editButton).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(shareButton).toHaveStyle({ filter: 'grayscale(100%)' })
  })

  it('collapses deep category breadcrumbs to the parent and current category', async () => {
    mockInitialPath = mockDeepPath

    render(<App />)

    const categoryBreadcrumb = await screen.findByLabelText('category breadcrumb')
    expect(within(categoryBreadcrumb).getByText('...')).toBeInTheDocument()
    expect(within(categoryBreadcrumb).queryByText('Human Anatomy')).not.toBeInTheDocument()
    expect(within(categoryBreadcrumb).getByText('Head Pathologies')).toBeInTheDocument()
    expect(
      within(categoryBreadcrumb).getByText('Intracranial Hemorrhages ICH 1'),
    ).toBeInTheDocument()
    expect(
      within(categoryBreadcrumb).getByLabelText('Skipped categories: Human Anatomy'),
    ).toBeInTheDocument()
  })

  it('collapses deep image breadcrumbs to the direct image category and image', async () => {
    mockInitialPath = mockDeepPath
    mockImage.categoryId = 3

    render(<App />)
    await screen.findByText('Intracranial Hemorrhages ICH 1')
    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    const imageBreadcrumb = screen.getByLabelText('image breadcrumb')
    expect(within(imageBreadcrumb).getByText('...')).toBeInTheDocument()
    expect(within(imageBreadcrumb).queryByText('Human Anatomy')).not.toBeInTheDocument()
    expect(within(imageBreadcrumb).queryByText('Head Pathologies')).not.toBeInTheDocument()
    expect(within(imageBreadcrumb).getByText('Intracranial Hemorrhages ICH 1')).toBeInTheDocument()
    expect(within(imageBreadcrumb).getByText('Specimen Image')).toBeInTheDocument()
    expect(
      within(imageBreadcrumb).getByLabelText(
        'Skipped categories: Human Anatomy / Head Pathologies',
      ),
    ).toBeInTheDocument()
  })

  it('keeps image-view controls fully opaque when category hidden state is inherited', () => {
    mockCategories.splice(0, mockCategories.length, {
      id: 1,
      label: 'Italian',
      parentId: null,
      children: [
        {
          id: 2,
          label: 'Gothic',
          parentId: 1,
          children: [],
          images: [],
          programIds: [],
          groupIds: [],
          status: 'active',
          sortOrder: 0,
          version: 1,
          cardImageId: null,
          metadataExtra: null,
        },
      ],
      images: [],
      programIds: [1],
      groupIds: [10],
      status: 'hidden',
      sortOrder: 0,
      version: 1,
      cardImageId: null,
      metadataExtra: null,
    })
    mockImage.categoryId = 2

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    const imageBreadcrumb = screen.getByLabelText('image breadcrumb').closest('div')
    expect(imageBreadcrumb).not.toBeNull()

    const programChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Pathology')
      .closest('[data-testid="program-chip"]')
    const groupChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Lab A2')
      .closest('[data-testid="group-chip"]')
    const hiddenButton = screen.getByRole('button', { name: 'Visibility: Hidden by category' })
    const editButton = screen.getByRole('button', { name: 'Edit Details' })
    const shareButton = screen.getByText('Share View').closest('button')

    expect(programChip).toHaveStyle({ filter: 'grayscale(100%)' })
    expectEffectiveOpacity(programChip, '1')
    expect(groupChip).toHaveStyle({ filter: 'grayscale(100%)' })
    expectEffectiveOpacity(groupChip, '1')
    expect(hiddenButton).toHaveStyle({ filter: 'grayscale(100%)' })
    expectEffectiveOpacity(hiddenButton, '1')
    expect(editButton).toHaveStyle({ filter: 'grayscale(100%)' })
    expectEffectiveOpacity(editButton, '1')
    expect(shareButton).toHaveStyle({ filter: 'grayscale(100%)' })
    expectEffectiveOpacity(shareButton, '1')
  })

  it('applies inherited shading to breadcrumb program and group chips for child categories', () => {
    mockCategories.splice(0, mockCategories.length, {
      id: 1,
      label: 'Parent',
      parentId: null,
      children: [
        {
          id: 2,
          label: 'Child',
          parentId: 1,
          children: [],
          images: [],
          programIds: [],
          groupIds: [],
          status: 'active',
          sortOrder: 0,
          version: 1,
          cardImageId: null,
          metadataExtra: null,
        },
      ],
      images: [],
      programIds: [1],
      groupIds: [10],
      status: 'active',
      sortOrder: 0,
      version: 1,
      cardImageId: null,
      metadataExtra: null,
    })
    mockImage.categoryId = 2

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open category' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open child category' }))

    const categoryBreadcrumb = screen.getByLabelText('category breadcrumb').closest('div')
    expect(categoryBreadcrumb).not.toBeNull()

    const categoryProgramChip = within(categoryBreadcrumb as HTMLElement)
      .getByText('Pathology')
      .closest('[data-testid="program-chip"]')
    const categoryGroupChip = within(categoryBreadcrumb as HTMLElement)
      .getByText('Lab A2')
      .closest('[data-testid="group-chip"]')

    expect(categoryProgramChip).toHaveStyle({ opacity: '0.6' })
    expect(categoryGroupChip).toHaveStyle({ opacity: '0.6' })

    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    const imageBreadcrumb = screen.getByLabelText('image breadcrumb').closest('div')
    expect(imageBreadcrumb).not.toBeNull()

    const imageProgramChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Pathology')
      .closest('[data-testid="program-chip"]')
    const imageGroupChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Lab A2')
      .closest('[data-testid="group-chip"]')

    expect(imageProgramChip).toHaveStyle({ opacity: '0.6' })
    expect(imageGroupChip).toHaveStyle({ opacity: '0.6' })
  })

  it('shows only effective program pills when a child category narrows direct programs', () => {
    mockPrograms.push({
      id: 2,
      name: 'Radiology',
      oidc_group: null,
      created_at: '',
      updated_at: '',
    })
    mockCategories.splice(0, mockCategories.length, {
      id: 1,
      label: 'Parent',
      parentId: null,
      children: [
        {
          id: 2,
          label: 'Child',
          parentId: 1,
          children: [],
          images: [],
          programIds: [1],
          groupIds: [],
          status: 'active',
          sortOrder: 0,
          version: 1,
          cardImageId: null,
          metadataExtra: null,
        },
      ],
      images: [],
      programIds: [1, 2],
      groupIds: [],
      status: 'active',
      sortOrder: 0,
      version: 1,
      cardImageId: null,
      metadataExtra: null,
    })

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open category' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open child category' }))

    const categoryBreadcrumb = screen.getByLabelText('category breadcrumb').closest('div')
    expect(categoryBreadcrumb).not.toBeNull()

    const directProgramChip = within(categoryBreadcrumb as HTMLElement)
      .getByText('Pathology')
      .closest('[data-testid="program-chip"]')

    expectEffectiveOpacity(directProgramChip, '1')
    expect(
      within(categoryBreadcrumb as HTMLElement).queryByText('Radiology'),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    const imageBreadcrumb = screen.getByLabelText('image breadcrumb').closest('div')
    expect(imageBreadcrumb).not.toBeNull()

    const imageProgramChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Pathology')
      .closest('[data-testid="program-chip"]')

    expectEffectiveOpacity(imageProgramChip, '1')
    expect(within(imageBreadcrumb as HTMLElement).queryByText('Radiology')).not.toBeInTheDocument()
  })

  it('resets expanded note state when selecting another image', () => {
    mockImage.note = 'A'.repeat(350)
    mockSecondImage.note = 'B'.repeat(350)
    currentImagesMock = [mockImage, mockSecondImage]

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    fireEvent.click(screen.getByRole('button', { name: /Show more/i }))
    expect(screen.getByRole('button', { name: /Show less/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select second image from search' }))

    expect(screen.queryByRole('button', { name: /Show less/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show more/i })).toBeInTheDocument()
  })

  it('does not load the announcement while auth is still loading', async () => {
    authState = {
      ...authState,
      currentUser: null,
      loading: true,
    }

    render(<App />)

    await screen.findByRole('progressbar')
    expect(announcementModalMock.loadAnnouncement).not.toHaveBeenCalled()
  })

  it('fetches component versions for instructors (canEditContent)', async () => {
    render(<App />)

    expect(vi.mocked(fetchVersions)).toHaveBeenCalledOnce()
    expect(vi.mocked(fetchFrontendVersion)).toHaveBeenCalledOnce()
  })

  it('does not fetch component versions for students', async () => {
    authState = {
      ...authState,
      currentUser: { ...mockCurrentUser, role: 'student' as const },
      canEditContent: false,
    }

    render(<App />)

    expect(vi.mocked(fetchVersions)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchFrontendVersion)).not.toHaveBeenCalled()
  })
})

describe('App failure notifications', () => {
  beforeEach(resetFixtures)

  it('rehydrates persisted failures for users who can edit content', async () => {
    render(<App />)
    await waitFor(() => expect(processingJobsMock.rehydrateFailedJobs).toHaveBeenCalled())
  })

  it('does not rehydrate failures for users without edit rights', () => {
    authState = { ...authState, canEditContent: false }
    render(<App />)
    expect(processingJobsMock.rehydrateFailedJobs).not.toHaveBeenCalled()
  })

  it('shows one snackbar per failure below the collapse threshold', () => {
    visibleJobsMock = [makeFailedJob(1), makeFailedJob(2), makeFailedJob(3), makeFailedJob(4)]
    render(<App />)

    expect(screen.getByText('Processing failed: reason 1')).toBeInTheDocument()
    expect(screen.getByText('Processing failed: reason 4')).toBeInTheDocument()
    expect(screen.queryByText(/uploads failed/)).not.toBeInTheDocument()
  })

  it('keeps client-side upload failures out of the collapsed summary', () => {
    visibleJobsMock = [1, 2, 3, 4, 5].map((id) => ({
      ...makeFailedJob(id),
      origin: 'live' as const,
      serverFailed: undefined,
    }))
    render(<App />)

    expect(screen.getByText('Processing failed: reason 1')).toBeInTheDocument()
    expect(screen.queryByText(/uploads failed/)).not.toBeInTheDocument()
  })

  it('collapses five or more failures into one summary that opens the failed uploads list', async () => {
    visibleJobsMock = [1, 2, 3, 4, 5].map(makeFailedJob)
    render(<App />)

    expect(screen.getByText('5 uploads failed.')).toBeInTheDocument()
    expect(screen.queryByText('Processing failed: reason 1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(await screen.findByRole('dialog', { name: 'Failed uploads' })).toBeInTheDocument()
  })

  it('dismisses every collapsed failure at once', () => {
    visibleJobsMock = [1, 2, 3, 4, 5].map(makeFailedJob)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss failed uploads' }))
    expect(processingJobsMock.dismissJob.mock.calls.map(([id]) => id)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('App shell interactions', () => {
  beforeEach(resetFixtures)

  it('reloads browse data when switching tabs back to browse and on home click', () => {
    render(<App />)

    const baseCategories = browseDataFns.loadCategories.mock.calls.length
    const baseImages = browseDataFns.loadUncategorizedImages.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Shell tab admin' }))
    expect(browseDataFns.loadCategories).toHaveBeenCalledTimes(baseCategories)

    fireEvent.click(screen.getByRole('button', { name: 'Shell tab browse' }))
    expect(browseDataFns.loadCategories).toHaveBeenCalledTimes(baseCategories + 1)
    expect(browseDataFns.loadUncategorizedImages).toHaveBeenCalledTimes(baseImages + 1)

    const baseClear = shareableImageStateMock.clearImage.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Shell home' }))
    expect(browseDataFns.loadCategories).toHaveBeenCalledTimes(baseCategories + 2)
    expect(browseDataFns.loadUncategorizedImages).toHaveBeenCalledTimes(baseImages + 2)
    expect(shareableImageStateMock.clearImage).toHaveBeenCalledTimes(baseClear + 1)
  })

  it('loads users for search when the search modal opens', async () => {
    vi.mocked(fetchUsers).mockResolvedValueOnce([
      { ...mockCurrentUser, id: 2, name: 'Student', role: 'student' },
    ])
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Shell search' }))
    expect(await screen.findByText('search users: 1')).toBeInTheDocument()
  })

  it('falls back to an empty user list when the search user fetch fails', async () => {
    // Seed a non-empty list first so the empty state is attributable to the
    // rejection fallback rather than the initial render state.
    vi.mocked(fetchUsers).mockResolvedValueOnce([
      { ...mockCurrentUser, id: 2, name: 'Student', role: 'student' },
    ])
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Shell search' }))
    expect(await screen.findByText('search users: 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    vi.mocked(fetchUsers).mockRejectedValueOnce(new Error('nope'))
    fireEvent.click(screen.getByRole('button', { name: 'Shell search' }))
    expect(await screen.findByText('search users: 0')).toBeInTheDocument()
  })

  it('fetches deployed component versions when content editing is allowed', async () => {
    authState = { ...authState, canEditContent: true }
    render(<App />)

    expect(await screen.findByText('versions: 1.0.0/1.0.0')).toBeInTheDocument()
  })

  it('clears versions when the version fetches fail', async () => {
    // Seed successful versions first so the null state is attributable to
    // the catch handlers rather than the initial render state.
    authState = { ...authState, canEditContent: true }
    const { rerender } = render(<App />)
    expect(await screen.findByText('versions: 1.0.0/1.0.0')).toBeInTheDocument()

    authState = { ...authState, canEditContent: false }
    rerender(<App />)
    expect(await screen.findByText('versions: null/null')).toBeInTheDocument()

    vi.mocked(fetchVersions).mockRejectedValueOnce(new Error('down'))
    vi.mocked(fetchFrontendVersion).mockRejectedValueOnce(new Error('down'))
    authState = { ...authState, canEditContent: true }
    rerender(<App />)
    await waitFor(() => expect(fetchVersions).toHaveBeenCalledTimes(2))
    expect(screen.getByText('versions: null/null')).toBeInTheDocument()
  })
})

describe('App program and group management', () => {
  beforeEach(resetFixtures)

  it('creates, edits, and deletes programs and reloads the program list', async () => {
    render(<App />)
    const basePrograms = browseDataFns.loadPrograms.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Shell programs' }))

    fireEvent.click(screen.getByRole('button', { name: 'Modal add program' }))
    await waitFor(() =>
      expect(createProgram).toHaveBeenCalledWith({ name: 'New Program', oidc_group: null }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Modal edit program' }))
    await waitFor(() =>
      expect(updateProgram).toHaveBeenCalledWith(1, {
        name: 'Renamed Program',
        oidc_group: 'oidc-grp',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Modal delete program' }))
    await waitFor(() => expect(deleteProgram).toHaveBeenCalledWith(1))

    await waitFor(() => expect(browseDataFns.loadPrograms).toHaveBeenCalledTimes(basePrograms + 3))
  })

  it('shows an error snackbar when adding a program fails', async () => {
    vi.mocked(createProgram).mockRejectedValueOnce(new Error('duplicate'))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Shell programs' }))

    fireEvent.click(screen.getByRole('button', { name: 'Modal add program' }))
    expect(await screen.findByText('Failed to add program.')).toBeInTheDocument()
  })

  it('creates, edits, and deletes groups and reloads the group list', async () => {
    render(<App />)
    const baseGroups = browseDataFns.loadGroups.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Shell groups' }))

    fireEvent.click(screen.getByRole('button', { name: 'Modal add group' }))
    await waitFor(() =>
      expect(createGroup).toHaveBeenCalledWith({ name: 'New Group', description: null }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Modal edit group' }))
    await waitFor(() =>
      expect(updateGroup).toHaveBeenCalledWith(10, { name: 'Renamed Group', description: 'desc' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Modal delete group' }))
    await waitFor(() => expect(deleteGroup).toHaveBeenCalledWith(10))

    await waitFor(() => expect(browseDataFns.loadGroups).toHaveBeenCalledTimes(baseGroups + 3))
  })

  it('rethrows group creation failures to the modal without reloading groups', async () => {
    vi.mocked(createGroup).mockRejectedValueOnce(new Error('taken'))
    render(<App />)
    const baseGroups = browseDataFns.loadGroups.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Shell groups' }))

    fireEvent.click(screen.getByRole('button', { name: 'Modal add group' }))
    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1))
    expect(browseDataFns.loadGroups).toHaveBeenCalledTimes(baseGroups)
  })
})

describe('App grid file drops and reorder feedback', () => {
  beforeEach(resetFixtures)

  it('warns about unsupported files dropped on the grid', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Drop files on grid' }))
    expect(
      await screen.findByText('1 file not supported (accepted: images, .zip)'),
    ).toBeInTheDocument()
  })

  it('warns when the category refresh after reorder fails', async () => {
    browseDataFns.refreshCategories.mockRejectedValueOnce(new Error('offline'))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Manage reorder complete' }))
    expect(
      await screen.findByText('Could not refresh categories after reorder.'),
    ).toBeInTheDocument()
  })

  it('warns when the image refresh after reorder fails', async () => {
    browseDataFns.refreshUncategorizedImages.mockRejectedValueOnce(new Error('offline'))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Manage reorder complete' }))
    expect(await screen.findByText('Could not refresh images after reorder.')).toBeInTheDocument()
  })

  it('toggles the file-drag state as native files drag over and leave the window', async () => {
    render(<App />)

    const makeDragEvent = (type: string, types: string[] = ['Files']) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { types } })
      return event
    }

    expect(screen.queryByText('File drag active')).not.toBeInTheDocument()

    fireEvent(window, makeDragEvent('dragenter'))
    expect(screen.getByText('File drag active')).toBeInTheDocument()

    // Non-file dragleave events must not decrement the counter (symmetric
    // Files filtering keeps the counter from going negative)
    fireEvent(window, makeDragEvent('dragleave', []))
    expect(screen.getByText('File drag active')).toBeInTheDocument()

    // Nested dragenter/dragleave pairs must not deactivate until the counter hits 0
    fireEvent(window, makeDragEvent('dragenter'))
    // dragover/drop must be prevented so the browser doesn't navigate to the file
    const dragOverEvent = makeDragEvent('dragover')
    fireEvent(window, dragOverEvent)
    expect(dragOverEvent.defaultPrevented).toBe(true)
    fireEvent(window, makeDragEvent('dragleave'))
    expect(screen.getByText('File drag active')).toBeInTheDocument()

    fireEvent(window, makeDragEvent('dragleave'))
    expect(screen.queryByText('File drag active')).not.toBeInTheDocument()

    // Drop resets the counter and clears the state on the next animation frame
    fireEvent(window, makeDragEvent('dragenter'))
    expect(screen.getByText('File drag active')).toBeInTheDocument()
    const dropEvent = makeDragEvent('drop')
    fireEvent(window, dropEvent)
    expect(dropEvent.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByText('File drag active')).not.toBeInTheDocument())
  })

  it('keeps a pending reorder refresh deferred while any drag surface is still active', async () => {
    render(<App />)

    // Start a Manage drag and queue a reorder refresh.
    fireEvent.click(screen.getByRole('button', { name: 'Start manage drag' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage reorder complete' }))

    // Start a Browse drag before the Manage drag finishes.
    fireEvent.click(screen.getByRole('button', { name: 'Start browse drag' }))
    fireEvent.click(screen.getByRole('button', { name: 'End manage drag' }))

    // Refresh must still be deferred because the Browse drag is active.
    expect(browseDataFns.refreshCategories).not.toHaveBeenCalled()
    expect(browseDataFns.refreshUncategorizedImages).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'End browse drag' }))
    await waitFor(() => {
      expect(browseDataFns.refreshCategories).toHaveBeenCalled()
      expect(browseDataFns.refreshUncategorizedImages).toHaveBeenCalled()
    })
  })
})

describe('App breadcrumb navigation links', () => {
  beforeEach(() => {
    resetFixtures()
    mockImage.categoryId = 3
    mockInitialPath = mockDeepPath
  })

  it('navigates to an ancestor depth from a category breadcrumb link', async () => {
    render(<App />)

    const categoryBreadcrumb = await screen.findByLabelText('category breadcrumb')
    fireEvent.click(within(categoryBreadcrumb).getByText('Head Pathologies'))

    await waitFor(() =>
      expect(
        within(screen.getByLabelText('category breadcrumb')).queryByText(
          'Intracranial Hemorrhages ICH 1',
        ),
      ).not.toBeInTheDocument(),
    )
  })

  it('returns to the root from the category breadcrumb Home link', async () => {
    render(<App />)

    const categoryBreadcrumb = await screen.findByLabelText('category breadcrumb')
    fireEvent.click(within(categoryBreadcrumb).getByText('Home'))

    await waitFor(() => expect(screen.queryByText('Head Pathologies')).not.toBeInTheDocument())
  })

  it('clears the image when navigating from an image breadcrumb category link', async () => {
    render(<App />)
    await screen.findByText('Intracranial Hemorrhages ICH 1')
    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    const imageBreadcrumb = screen.getByLabelText('image breadcrumb')
    fireEvent.click(within(imageBreadcrumb).getByText('Intracranial Hemorrhages ICH 1'))
    expect(shareableImageStateMock.clearImage).toHaveBeenCalled()
  })

  it('clears the image when navigating from the image breadcrumb Home link', async () => {
    render(<App />)
    await screen.findByText('Intracranial Hemorrhages ICH 1')
    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    fireEvent.click(within(screen.getByLabelText('image breadcrumb')).getByText('Home'))
    expect(shareableImageStateMock.clearImage).toHaveBeenCalled()
  })
})
