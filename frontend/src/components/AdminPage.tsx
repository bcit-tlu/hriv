import { useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import DownloadIcon from '@mui/icons-material/Download'
import FolderZipIcon from '@mui/icons-material/FolderZip'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { exportDatabase, importDatabase, exportFiles, importFiles } from '../api'
import type { ImportResult, FilesImportResult } from '../api'

export default function AdminPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportingFiles, setExportingFiles] = useState(false)
  const [importingFiles, setImportingFiles] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [filesResult, setFilesResult] = useState<FilesImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = exporting || importing || exportingFiles || importingFiles

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

  const handleExportFiles = async () => {
    setError(null)
    setExportingFiles(true)
    try {
      await exportFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File export failed')
    } finally {
      setExportingFiles(false)
    }
  }

  const handleImportFilesClick = () => {
    filesRef.current?.click()
  }

  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setError(null)
    setFilesResult(null)
    setImportingFiles(true)
    try {
      const res = await importFiles(file)
      setFilesResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File import failed')
    } finally {
      setImportingFiles(false)
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
          Database import complete — {result.imported.categories} categories,{' '}
          {result.imported.images} images, {result.imported.users} users
          {result.imported.source_images ? `, ${result.imported.source_images} source images` : ''} loaded.
        </Alert>
      )}

      {filesResult && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setFilesResult(null)}>
          File import complete — {filesResult.restored.tile_files} tile files,{' '}
          {filesResult.restored.source_files} source files restored.
        </Alert>
      )}

      {/* ── Database Section ──────────────────────────────── */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Database
      </Typography>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 4 }}>
        {/* Export card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: '#fff' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Export Database
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Download a JSON snapshot of all categories, images, users, and
              source image records. This file can be used to restore the
              database later.
            </Typography>
            <Button
              variant="contained"
              startIcon={exporting ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
              onClick={handleExport}
              disabled={busy}
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
              disabled={busy}
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
      </Box>

      <Divider sx={{ mb: 4 }} />

      {/* ── Filesystem Section ────────────────────────────── */}
      <Typography variant="h6" sx={{ mb: 2 }}>
        Filesystem
      </Typography>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {/* Export Files card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: '#fff' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Export Files
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Download a compressed archive (.tar.gz) of all image tiles,
              thumbnails, and uploaded source files. Use together with the
              database export for a complete system backup.
            </Typography>
            <Button
              variant="contained"
              startIcon={exportingFiles ? <CircularProgress size={18} color="inherit" /> : <FolderZipIcon />}
              onClick={handleExportFiles}
              disabled={busy}
            >
              {exportingFiles ? 'Exporting…' : 'Export'}
            </Button>
          </CardContent>
        </Card>

        {/* Import Files card */}
        <Card sx={{ minWidth: 300, maxWidth: 400, flex: '1 1 300px', bgcolor: '#fff' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Import Files
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload a previously exported .tar.gz file to replace all tiles
              and source files on disk. This action is destructive — existing
              files will be overwritten.
            </Typography>
            <Button
              variant="contained"
              color="warning"
              startIcon={importingFiles ? <CircularProgress size={18} color="inherit" /> : <UploadFileIcon />}
              onClick={handleImportFilesClick}
              disabled={busy}
            >
              {importingFiles ? 'Importing…' : 'Import'}
            </Button>
            <input
              ref={filesRef}
              type="file"
              accept=".tar.gz,.tgz"
              hidden
              onChange={handleFilesChange}
            />
          </CardContent>
        </Card>
      </Box>
    </Box>
  )
}
