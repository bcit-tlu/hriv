import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import type { ApiImage } from '../api'

export interface ImageFormData {
  label?: string
  copyright?: string
  origin?: string
  program?: string
  status?: string
}

interface EditImageModalProps {
  open: boolean
  onClose: () => void
  onSave: (data: ImageFormData) => void
  image: ApiImage | null
}

function EditImageForm({
  onClose,
  onSave,
  image,
}: Omit<EditImageModalProps, 'open'>) {
  const [label, setLabel] = useState(image?.label ?? '')
  const [copyright, setCopyright] = useState(image?.copyright ?? '')
  const [origin, setOrigin] = useState(image?.origin ?? '')
  const [program, setProgram] = useState(image?.program ?? '')
  const [status, setStatus] = useState(image?.status ?? '')

  const handleSave = () => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return
    onSave({
      label: trimmedLabel,
      copyright: copyright.trim() || undefined,
      origin: origin.trim() || undefined,
      program: program.trim() || undefined,
      status: status.trim() || undefined,
    })
  }

  return (
    <>
      <DialogTitle>Image Details</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        <TextField
          autoFocus
          label="Label"
          fullWidth
          variant="outlined"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <TextField
          label="Copyright"
          fullWidth
          variant="outlined"
          value={copyright}
          onChange={(e) => setCopyright(e.target.value)}
        />
        <TextField
          label="Origin"
          fullWidth
          variant="outlined"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
        />
        <TextField
          label="Program"
          fullWidth
          variant="outlined"
          value={program}
          onChange={(e) => setProgram(e.target.value)}
        />
        <TextField
          label="Status"
          fullWidth
          variant="outlined"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!label.trim()}
        >
          Save
        </Button>
      </DialogActions>
    </>
  )
}

export default function EditImageModal({
  open,
  onClose,
  onSave,
  image,
}: EditImageModalProps) {
  const formKey = image ? `edit-${image.id}` : 'closed'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      {open && (
        <EditImageForm
          key={formKey}
          onClose={onClose}
          onSave={onSave}
          image={image}
        />
      )}
    </Dialog>
  )
}
