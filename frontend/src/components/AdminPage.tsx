import { useEffect, useRef, useState, useCallback } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CampaignIcon from '@mui/icons-material/Campaign'
import CollectionsIcon from '@mui/icons-material/Collections'
import DownloadIcon from '@mui/icons-material/Download'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { exportDatabase, importDatabase, fetchAnnouncement, updateAnnouncement, fetchCategoryTree, createCategory as apiCreateCategory, updateCategory as apiUpdateCategory } from '../api'
import type { ApiCategoryTree, ImportResult } from '../api'
import BulkImportModal from './BulkImportModal'
import type { Category } from '../types'

function apiTreeToCategory(node: ApiCategoryTree): Category {
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
    })),
    program: node.program,
    status: node.status,
  }
}

interface AdminPageProps {
  onAnnouncementChange?: () => void
}

export default function AdminPage({ onAnnouncementChange }: AdminPageProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Announcement state
  const [annMessage, setAnnMessage] = useState('')
  const [annEnabled, setAnnEnabled] = useState(false)
  const [annModalOpen, setAnnModalOpen] = useState(false)
  const [annDraftMessage, setAnnDraftMessage] = useState('')
  const [annDraftEnabled, setAnnDraftEnabled] = useState(false)
  const [annSaving, setAnnSaving] = useState(false)

  // Bulk import state
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])

  const loadCategories = useCallback(async () => {
    try {
      const tree = await fetchCategoryTree()
      setCategories(tree.map(apiTreeToCategory))
    } catch {
      // ignore
    }
  }, [])

  const addCategoryInline = useCallback(
    async (label: string, parentId: number | null) => {
      try {
        await apiCreateCategory({ label, parent_id: parentId })
        await loadCategories()
      } catch (err) {
        console.error('Failed to create category', err)
      }
    },
    [loadCategories],
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

  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  useEffect(() => {
    fetchAnnouncement()
      .then((ann) => {
        setAnnMessage(ann.message)
        setAnnEnabled(ann.enabled)
      })
      .catch(() => {})
  }, [])

  const openAnnModal = () => {
    setAnnDraftMessage(annMessage)
    setAnnDraftEnabled(annEnabled)
    setAnnModalOpen(true)
  }

  const handleAnnSave = async () => {
    setAnnSaving(true)
    try {
      const updated = await updateAnnouncement({
        message: annDraftMessage,
        enabled: annDraftEnabled,
      })
      setAnnMessage(updated.message)
      setAnnEnabled(updated.enabled)
      setAnnModalOpen(false)
      onAnnouncementChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update announcement')
    } finally {
      setAnnSaving(false)
    }
  }

  const handleExport = async () => {
    setError(null)
    setExporting(true)
    try {
      await exportDatabase()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleImportClick = () => {
    fileRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset the input so the same file can be re-selected
    e.target.value = ''

    setError(null)
    setResult(null)
    setImporting(true)
    try {
      const res = await importDatabase(file)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Admin
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {result && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setResult(null)}>
          Import complete — {result.imported.categories} categories,{' '}
          {result.imported.images} images, {result.imported.users} users loaded.
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {/* Export card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: '#fff' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Export Database
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Download a JSON snapshot of all categories, images, and users.
              This file can be used to restore the database later.
            </Typography>
            <Button
              variant="contained"
              startIcon={exporting ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
              onClick={handleExport}
              disabled={exporting || importing}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          </CardContent>
        </Card>

        {/* Import card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: '#fff' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Import Database
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload a previously exported JSON file to replace all current
              data. This action is destructive — existing records will be
              overwritten.
            </Typography>
            <Button
              variant="contained"
              color="warning"
              startIcon={importing ? <CircularProgress size={18} color="inherit" /> : <UploadFileIcon />}
              onClick={handleImportClick}
              disabled={exporting || importing}
            >
              {importing ? 'Importing…' : 'Import'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              hidden
              onChange={handleFileChange}
            />
          </CardContent>
        </Card>
        {/* Bulk Import card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: '#fff' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Bulk Import Images
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload multiple image files or a zip archive to import them all
              at once into a category. Images are processed in the background.
            </Typography>
            <Button
              variant="contained"
              startIcon={<CollectionsIcon />}
              onClick={() => setBulkImportOpen(true)}
              color="success"
            >
              Bulk Import
            </Button>
          </CardContent>
        </Card>

        {/* Announcement card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: '#fff' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Announcement
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Configure a site-wide banner that appears on all pages,
              including the login screen.
            </Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Status:{' '}
              <Typography
                component="span"
                variant="body2"
                sx={{ fontWeight: 600, color: annEnabled ? 'success.main' : 'text.disabled' }}
              >
                {annEnabled ? 'Active' : 'Inactive'}
              </Typography>
            </Typography>
            <Button
              variant="contained"
              startIcon={<CampaignIcon />}
              onClick={openAnnModal}
              sx={{ bgcolor: 'secondary.main', '&:hover': { bgcolor: 'secondary.dark' } }}
            >
              Manage
            </Button>
          </CardContent>
        </Card>
      </Box>

      {/* Announcement modal */}
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

      {/* Bulk import modal */}
      <BulkImportModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        categories={categories}
        onAddCategory={addCategoryInline}
        onEditCategory={editCategoryInline}
        onToggleVisibility={toggleCategoryVisibility}
      />
    </Box>
  )
}
