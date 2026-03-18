import { useState, useCallback, useEffect, useRef } from 'react'
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
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import HomeIcon from '@mui/icons-material/Home'
import ImageViewer from './components/ImageViewer'
import CategoryTile from './components/CategoryTile'
import ImageTile from './components/ImageTile'
import AddCategoryDialog from './components/AddCategoryDialog'
import AdminPage from './components/AdminPage'
import AnnouncementBanner from './components/AnnouncementBanner'
import AddEditPersonModal from './components/AddEditPersonModal'
import ManagePage from './components/ManagePage'
import PeoplePage from './components/PeoplePage'
import LoginScreen from './components/LoginScreen'
import { useAuth } from './useAuth'
import {
  fetchCategoryTree,
  fetchAnnouncement,
  createCategory as apiCreateCategory,
} from './api'
import type { ApiCategoryTree, ApiUser } from './api'
import { updateUser as apiUpdateUser, fetchPrograms as apiFetchPrograms } from './api'
import type { Category, ImageItem, Program } from './types'
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
  const [announcement, setAnnouncement] = useState('')

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

  // Reset navigation state when user identity changes (login/logout/switch)
  useEffect(() => {
    setPage('browse')
    setPath([])
    setSelectedImage(null)
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
              setSelectedImage(null)
              setPath([])
            }}
            textColor="inherit"
            TabIndicatorProps={{ style: { backgroundColor: 'white' } }}
            sx={{ flexGrow: 1 }}
          >
            <Tab label="Home" value="browse" />
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
                      Sign out
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
      <Box component="main" sx={{ flexGrow: 1, py: 3 }}>
        <Container maxWidth="lg">
          {page === 'admin' && canManageUsers ? (
            <AdminPage onAnnouncementChange={loadAnnouncement} />
          ) : page === 'people' && canManageUsers ? (
            <PeoplePage />
          ) : page === 'manage' && canEditContent ? (
            <ManagePage
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
            />
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

    </Box>
  )
}
