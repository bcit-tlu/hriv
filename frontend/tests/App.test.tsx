import { createRef, useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import App from '../src/App'

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

const browseDataFns = {
  setGroups: vi.fn(),
  loadCategories: vi.fn(),
  loadUncategorizedImages: vi.fn(),
  loadPrograms: vi.fn(),
  loadGroups: vi.fn(),
  refreshCategories: vi.fn(),
  refreshUncategorizedImages: vi.fn(),
}

const processingJobsMock = {
  getDisplayProgress: vi.fn(),
  getStatusMessage: vi.fn(),
  getUploadProgress: vi.fn(),
  getVisibleJobs: () => [],
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
  flushCanvasAnnotations: vi.fn(),
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
  reorderCategoriesInline: vi.fn(),
  reorderImagesInline: vi.fn(),
  handleMoveCategory: vi.fn(),
  handleRequestMoveCategory: vi.fn(),
  handleDropImageOnCategory: vi.fn(),
  handleDropCategoryOnCategory: vi.fn(),
  handleSetCardImage: vi.fn(),
}

vi.mock('../src/components/AppShell', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../src/components/SortableTileGrid', () => ({
  default: ({
    currentImages,
    currentCategories,
    onImageClick,
    onCategoryClick,
  }: {
    currentImages: (typeof mockImage)[]
    currentCategories: typeof mockCategories
    onImageClick: (img: typeof mockImage) => void
    onCategoryClick: (category: (typeof mockCategories)[number]) => void
  }) => (
    <>
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

vi.mock('../src/components/ManageCategoriesDialog', () => ({ default: () => null }))
vi.mock('../src/components/AdminPage', () => ({ default: () => null }))
vi.mock('../src/components/PeoplePage', () => ({ default: () => null }))
vi.mock('../src/components/ManagePage', () => ({ default: () => null }))
vi.mock('../src/components/LoginScreen', () => ({ default: () => null }))
vi.mock('../src/components/EditImageModal', () => ({ default: () => null }))
vi.mock('../src/components/ProgramManagementModal', () => ({ default: () => null }))
vi.mock('../src/components/GroupManagementModal', () => ({ default: () => null }))
vi.mock('../src/components/ReportIssueModal', () => ({ default: () => null }))
vi.mock('../src/observability', () => ({
  emitEvent: (...args: unknown[]) => emitEventMock(...args),
  emitSessionStartedOnce: (...args: unknown[]) => emitSessionStartedOnceMock(...args),
}))
vi.mock('../src/components/SearchModal', () => ({
  default: ({
    onSelectImage,
  }: {
    onSelectImage: (image: typeof mockSecondImage, categoryPath: typeof mockCategories) => void
  }) => (
    <button type="button" onClick={() => onSelectImage(mockSecondImage, mockCategories)}>
      Select second image from search
    </button>
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
    vi.clearAllMocks()
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
      .closest('.MuiChip-root')
    const groupChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Lab A2')
      .closest('.MuiChip-root')
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

  it('reduces opacity for image-view controls when category hidden state is inherited', () => {
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
      .closest('.MuiChip-root')
    const groupChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Lab A2')
      .closest('.MuiChip-root')
    const hiddenButton = screen.getByRole('button', { name: 'Visibility: Hidden by category' })
    const editButton = screen.getByRole('button', { name: 'Edit Details' })
    const shareButton = screen.getByText('Share View').closest('button')

    expect(programChip).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(programChip).toHaveStyle({ opacity: '0.5' })
    expect(groupChip).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(groupChip).toHaveStyle({ opacity: '0.5' })
    expect(hiddenButton).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(hiddenButton).toHaveStyle({ opacity: '0.5' })
    expect(editButton).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(editButton).toHaveStyle({ opacity: '0.5' })
    expect(shareButton).toHaveStyle({ filter: 'grayscale(100%)' })
    expect(shareButton).toHaveStyle({ opacity: '0.5' })
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
      .closest('.MuiChip-root')
    const categoryGroupChip = within(categoryBreadcrumb as HTMLElement)
      .getByText('Lab A2')
      .closest('.MuiChip-root')

    expect(categoryProgramChip).toHaveStyle({ opacity: '0.6' })
    expect(categoryGroupChip).toHaveStyle({ opacity: '0.6' })

    fireEvent.click(screen.getByRole('button', { name: 'Open image' }))

    const imageBreadcrumb = screen.getByLabelText('image breadcrumb').closest('div')
    expect(imageBreadcrumb).not.toBeNull()

    const imageProgramChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Pathology')
      .closest('.MuiChip-root')
    const imageGroupChip = within(imageBreadcrumb as HTMLElement)
      .getByText('Lab A2')
      .closest('.MuiChip-root')

    expect(imageProgramChip).toHaveStyle({ opacity: '0.6' })
    expect(imageGroupChip).toHaveStyle({ opacity: '0.6' })
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
})
