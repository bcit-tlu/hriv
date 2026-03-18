import { useEffect, useRef, useState } from 'react'
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
import DownloadIcon from '@mui/icons-material/Download'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { exportDatabase, importDatabase, fetchAnnouncement, updateAnnouncement } from '../api'
import type { ImportResult } from '../api'

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
    <Box
      sx={{
        bgcolor: '#d1cdcd',
        borderRadius: 2,
        p: 3,
      }}
    >
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
    </Box>
  )
}
