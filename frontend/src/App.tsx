import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Popover from '@mui/material/Popover'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import MuiBreadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Snackbar from '@mui/material/Snackbar'
import Tooltip from '@mui/material/Tooltip'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import HomeIcon from '@mui/icons-material/Home'
import LinkIcon from '@mui/icons-material/Link'
import ImageViewer from './components/ImageViewer'
import type { ViewportState } from './components/ImageViewer'
import CategoryTile from './components/CategoryTile'
import ImageTile from './components/ImageTile'
import AddCategoryDialog from './components/AddCategoryDialog'
import AdminPage from './components/AdminPage'
import AnnouncementBanner from './components/AnnouncementBanner'
import AddEditPersonModal from './components/AddEditPersonModal'
import ManagePage from './components/ManagePage'
import PeoplePage from './components/PeoplePage'
import LoginScreen from './components/LoginScreen'
import UploadImageModal from './components/UploadImageModal'
import { useAuth } from './useAuth'
import {
  fetchCategoryTree,
  fetchAnnouncement,
  fetchUncategorizedImages,
  createCategory as apiCreateCategory,
  updateCategory as apiUpdateCategory,
} from './api'
import type { ApiCategoryTree, ApiImage, ApiUser } from './api'
import { updateUser as apiUpdateUser, fetchPrograms as apiFetchPrograms } from './api'
import MoveCategoryDialog from './components/MoveCategoryDialog'
import type { Category, ImageItem, Program } from './types'
import { MAX_DEPTH } from './types'

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

function apiTreeToCategory(node: ApiCategoryTree): Category {
  return {
    id: node.id,
    label: node.label,
    parentId: node.parent_id,
    children: node.children.map(apiTreeToCategory),
    images: node.images.map((img) => ({
      id: img.id,
      label: img.label,
      thumb: img.thumb,
      tileSources: img.tile_sources,
      copyright: img.copyright,
      origin: img.origin,
      program: img.program,
      status: img.status,
    })),
    program: node.program,
    status: node.status,
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
  const [snackOpen, setSnackOpen] = useState(false)
  const pendingImageId = useRef<number | null>(null)
  const pendingViewport = useRef<ViewportState | undefined>(undefined)
  const uncategorizedLoaded = useRef(false)

  // Move category dialog state
  const [moveCatOpen, setMoveCatOpen] = useState(false)
  const [movingCategory, setMovingCategory] = useState<Category | null>(null)

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

  // Load announcement (works for both logged-in and login page)
  const loadAnnouncement = useCallback(async () => {
    try {
      const ann = await fetchAnnouncement()
      setAnnouncement(ann.enabled ? ann.message : '')
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
            pendingViewport.current = { zoom, x, y }
          }
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
    setProfileOpen(false)
    setEditModalOpen(false)
  }, [currentUser])

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
          label: img.label,
          thumb: img.thumb,
          tileSources: img.tile_sources,
          copyright: img.copyright,
          origin: img.origin,
          program: img.program,
          status: img.status,
        })),
      )
      uncategorizedLoaded.current = true
    } catch (err) {
      console.error('Failed to load uncategorized images', err)
      uncategorizedLoaded.current = true
    }
  }, [])

  useEffect(() => {
    if (currentUser) {
      loadCategories()
      loadUncategorizedImages()
    }
  }, [currentUser, loadCategories, loadUncategorizedImages])

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
      return
    }

    const result = findImageInTree(categories, id)
    if (result) {
      pendingImageId.current = null
      setPath(result.path)
      setSelectedImage(result.image)
      setViewportState(pendingViewport.current)
      pendingViewport.current = undefined
    } else if (!categoriesLoading && uncategorizedLoaded.current) {
      // Both data sources have loaded — image doesn't exist.
      // Clear pending state and URL so URL sync can resume normally.
      pendingImageId.current = null
      pendingViewport.current = undefined
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
      }
    }
    const qs = params.toString()
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, '', newUrl)
  }, [selectedImage, viewportState])

  const handleViewportChange = useCallback((state: ViewportState) => {
    setViewportState(state)
  }, [])

  // Memoize initialViewport so it stays referentially stable per image
  const initialViewport = useMemo(() => viewportState, [selectedImage]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const currentDepth = path.length

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

  const { cats: currentCategories, imgs: currentImages } = resolve()

  const clearImage = useCallback(() => {
    setSelectedImage(null)
    setViewportState(undefined)
  }, [])

  const navigateToCategory = (cat: Category) => {
    setPath((prev) => [...prev, cat])
  }

  const navigateToDepth = (depth: number) => {
    setPath((prev) => prev.slice(0, depth))
  }

  const addCategory = useCallback(
    async (label: string) => {
      const parentId = path.length > 0 ? path[path.length - 1].id : null
      try {
        await apiCreateCategory({ label, parent_id: parentId })
        await loadCategories()
      } catch (err) {
        console.error('Failed to create category', err)
      }
    },
    [path, loadCategories],
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
          <Typography variant="h6" component="h1" sx={{ mr: 2 }}>
            Corgi
          </Typography>
          <Tabs
            value={page}
            onChange={(_, v: Page) => {
              setPage(v)
              clearImage()
              setPath([])
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
            {canManageUsers && <Tab label="People" value="people" />}
            {canManageUsers && <Tab label="Admin" value="admin" />}
          </Tabs>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                          apiFetchPrograms()
                            .then((p) => setPrograms(p.map((pg) => ({ id: pg.id, name: pg.name, created_at: pg.created_at, updated_at: pg.updated_at }))))
                            .catch(() => {})
                          setEditModalOpen(true)
                        }}
                      >
                        Update
                      </Link>
                    )}
                    <Link
                      component="button"
                      variant="body2"
                      color="error"
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
          bgcolor: page === 'people' || page === 'admin' ? '#d1cdcd' : undefined,
        }}
      >
        <Container maxWidth="lg">
          {page === 'admin' && canManageUsers ? (
            <AdminPage onAnnouncementChange={loadAnnouncement} />
          ) : page === 'people' && canManageUsers ? (
            <PeoplePage />
          ) : page === 'manage' && canEditContent ? (
            <ManagePage
              categories={categories}
              onViewImage={(img) => {
                setSelectedImage({
                  id: img.id,
                  label: img.label,
                  thumb: img.thumb,
                  tileSources: img.tile_sources,
                  copyright: img.copyright,
                  origin: img.origin,
                  program: img.program,
                  status: img.status,
                })
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
              onNewCategory={() => setDialogOpen(true)}
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
                    {selectedImage.label}
                  </Typography>
                </MuiBreadcrumbs>
                {canEditContent && (
                  <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    {currentDepth < MAX_DEPTH && (
                      <Button
                        variant="contained"
                        startIcon={<CreateNewFolderIcon />}
                        onClick={() => setDialogOpen(true)}
                      >
                        New Category
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      startIcon={<AddPhotoAlternateIcon />}
                      onClick={() => setUploadOpen(true)}
                    >
                      Upload Image
                    </Button>
                  </Box>
                )}
              </Box>

              <Paper elevation={3} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <ImageViewer
                  tileSources={selectedImage.tileSources}
                  initialViewport={initialViewport}
                  onViewportChange={handleViewportChange}
                />
              </Paper>

              <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  Use your scroll wheel to zoom, or click and drag to pan.
                  Pinch-to-zoom is supported on touch devices. The mini-map in
                  the bottom-right corner shows your current viewport.
                </Typography>
                <Tooltip title="Copy shareable link to clipboard">
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<LinkIcon />}
                    onClick={copyShareLink}
                    sx={{ flexShrink: 0, ml: 2 }}
                  >
                    Share View
                  </Button>
                </Tooltip>
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
                    {currentDepth < MAX_DEPTH && (
                      <Button
                        variant="contained"
                        startIcon={<CreateNewFolderIcon />}
                        onClick={() => setDialogOpen(true)}
                      >
                        New Category
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      startIcon={<AddPhotoAlternateIcon />}
                      onClick={() => setUploadOpen(true)}
                    >
                      Upload Image
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
                  />
                ))}
                {path.length === 0 &&
                  uncategorizedImages.map((img) => (
                    <ImageTile
                      key={img.id}
                      image={img}
                      onClick={setSelectedImage}
                    />
                  ))}
                {currentImages.map((img) => (
                  <ImageTile
                    key={img.id}
                    image={img}
                    onClick={setSelectedImage}
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
          py: 2,
          textAlign: 'center',
          bgcolor: 'grey.100',
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          Built with React, Vite, Material UI &amp; OpenSeadragon
        </Typography>
      </Box>

      {/* Add category dialog */}
      <AddCategoryDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAdd={addCategory}
        currentDepth={currentDepth}
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
      />

      {/* Upload image modal */}
      <UploadImageModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          loadCategories()
          loadUncategorizedImages()
        }}
        categoryId={path.length > 0 ? path[path.length - 1].id : null}
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

      {/* Share-link snackbar */}
      <Snackbar
        open={snackOpen}
        autoHideDuration={3000}
        onClose={() => setSnackOpen(false)}
        message="Link copied to clipboard"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

    </Box>
  )
}
