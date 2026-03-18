import { useState, useCallback, useEffect } from 'react'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import MuiBreadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import HomeIcon from '@mui/icons-material/Home'
import LogoutIcon from '@mui/icons-material/Logout'
import ImageViewer from './components/ImageViewer'
import CategoryTile from './components/CategoryTile'
import ImageTile from './components/ImageTile'
import AddCategoryDialog from './components/AddCategoryDialog'
import AdminPage from './components/AdminPage'
import ManagePage from './components/ManagePage'
import PeoplePage from './components/PeoplePage'
import LoginScreen from './components/LoginScreen'
import { useAuth } from './useAuth'
import {
  fetchCategoryTree,
  createCategory as apiCreateCategory,
} from './api'
import type { ApiCategoryTree } from './api'
import type { Category, ImageItem } from './types'
import { MAX_DEPTH } from './types'

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

  // Reset navigation state when user identity changes (login/logout/switch)
  useEffect(() => {
    setPage('browse')
    setPath([])
    setSelectedImage(null)
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

  useEffect(() => {
    if (currentUser) {
      loadCategories()
    }
  }, [currentUser, loadCategories])

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
    return <LoginScreen onLogin={login} />
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* App bar */}
      <AppBar position="static" elevation={1}>
        <Toolbar>
          {(selectedImage || path.length > 0) && (
            <IconButton
              edge="start"
              color="inherit"
              aria-label="back"
              sx={{ mr: 1 }}
              onClick={() => {
                if (selectedImage) {
                  setSelectedImage(null)
                } else {
                  navigateToDepth(path.length - 1)
                }
              }}
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography variant="h6" component="h1" sx={{ mr: 2 }}>
            Corgi
          </Typography>
          <Tabs
            value={page}
            onChange={(_, v: Page) => {
              setPage(v)
              setSelectedImage(null)
              setPath([])
            }}
            textColor="inherit"
            TabIndicatorProps={{ style: { backgroundColor: 'white' } }}
            sx={{ flexGrow: 1 }}
          >
            <Tab label="Browse" value="browse" />
            {canEditContent && <Tab label="Manage" value="manage" />}
            {canManageUsers && <Tab label="People" value="people" />}
            {canManageUsers && <Tab label="Admin" value="admin" />}
          </Tabs>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={`${currentUser.name} (${currentUser.role})`}
              size="small"
              sx={{
                color: 'white',
                borderColor: 'rgba(255,255,255,0.5)',
              }}
              variant="outlined"
            />
            <IconButton
              color="inherit"
              aria-label="sign out"
              onClick={logout}
            >
              <LogoutIcon />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Main content */}
      <Box component="main" sx={{ flexGrow: 1, py: 3 }}>
        <Container maxWidth="lg">
          {page === 'admin' && canManageUsers ? (
            <AdminPage />
          ) : page === 'people' && canManageUsers ? (
            <PeoplePage />
          ) : page === 'manage' && canEditContent ? (
            <ManagePage />
          ) : selectedImage ? (
            /* ---- Viewer mode ---- */
            <>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: 2,
                }}
              >
                <Typography variant="h5">{selectedImage.label}</Typography>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setSelectedImage(null)}
                >
                  Back
                </Button>
              </Box>

              <Paper elevation={3} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <ImageViewer tileSources={selectedImage.tileSources} />
              </Paper>

              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Use your scroll wheel to zoom, or click and drag to pan.
                  Pinch-to-zoom is supported on touch devices. The mini-map in
                  the bottom-right corner shows your current viewport.
                </Typography>
              </Box>
            </>
          ) : (
            /* ---- Browse mode ---- */
            <>
              {/* Breadcrumbs */}
              <Box sx={{ mb: 2 }}>
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
              </Box>

              {/* Add-category button (admin + instructor only) */}
              {canEditContent && currentDepth < MAX_DEPTH && (
                <Box sx={{ mb: 2 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<CreateNewFolderIcon />}
                    onClick={() => setDialogOpen(true)}
                  >
                    New Category
                  </Button>
                </Box>
              )}

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
                currentImages.length === 0 && (
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

    </Box>
  )
}
