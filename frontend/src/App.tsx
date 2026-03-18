import { useState, useCallback } from 'react'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import MuiBreadcrumbs from '@mui/material/Breadcrumbs'
import Link from '@mui/material/Link'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import HomeIcon from '@mui/icons-material/Home'
import ImageViewer from './components/ImageViewer'
import CategoryTile from './components/CategoryTile'
import ImageTile from './components/ImageTile'
import AddCategoryDialog from './components/AddCategoryDialog'
import { rootCategories as initialData } from './data'
import type { Category, ImageItem } from './types'
import { MAX_DEPTH } from './types'

export default function App() {
  const [categories, setCategories] = useState<Category[]>(initialData)
  const [path, setPath] = useState<Category[]>([])
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

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
    (label: string) => {
      const newCat: Category = {
        id: `cat-${Date.now()}`,
        label,
        children: [],
        images: [],
      }

      const updateChildren = (
        cats: Category[],
        pathIndex: number,
      ): Category[] => {
        if (pathIndex >= path.length) {
          return [...cats, newCat]
        }
        return cats.map((c) => {
          if (c.id === path[pathIndex].id) {
            return {
              ...c,
              children: updateChildren(c.children, pathIndex + 1),
            }
          }
          return c
        })
      }

      setCategories((prev) => updateChildren(prev, 0))
    },
    [path],
  )

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
          <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
            Corgi
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            Image Library
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Main content */}
      <Box component="main" sx={{ flexGrow: 1, py: 3 }}>
        <Container maxWidth="lg">
          {selectedImage ? (
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

              {/* Add-category button */}
              {currentDepth < MAX_DEPTH && (
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

              {currentCategories.length === 0 &&
                currentImages.length === 0 && (
                  <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{ mt: 4, textAlign: 'center' }}
                  >
                    This category is empty. Add a sub-category to get started.
                  </Typography>
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
