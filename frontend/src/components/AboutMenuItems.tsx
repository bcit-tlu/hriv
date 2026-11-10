import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import MenuBookIcon from '@mui/icons-material/MenuBook'

export interface AboutMenuItemsProps {
  frontendVersion: string | null
  backendVersion: string | null
  backupVersion: string | null
  /** Shown to users who can open the Documentation page. */
  onOpenGuide?: () => void
  /** Called before navigating/opening so the host popover can close. */
  onNavigate?: () => void
}

/** Documentation + About entries for the profile popover (moved from the bell menu). */
export default function AboutMenuItems({
  frontendVersion,
  backendVersion,
  backupVersion,
  onOpenGuide,
  onNavigate,
}: AboutMenuItemsProps) {
  const [aboutOpen, setAboutOpen] = useState(false)
  return (
    <>
      {onOpenGuide && (
        <MenuItem
          sx={{ py: 1.25 }}
          onClick={() => {
            onNavigate?.()
            onOpenGuide()
          }}
        >
          <ListItemIcon sx={{ minWidth: 0, mr: 1.25 }}>
            <MenuBookIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Documentation</ListItemText>
        </MenuItem>
      )}
      <MenuItem
        sx={{ py: 1.25 }}
        onClick={() => {
          onNavigate?.()
          setAboutOpen(true)
        }}
      >
        <ListItemIcon sx={{ minWidth: 0, mr: 1.25 }}>
          <InfoOutlinedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>About</ListItemText>
      </MenuItem>

      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>About HRIV</DialogTitle>
        <DialogContent>
          <Typography variant="body1" fontWeight={600} gutterBottom>
            High Resolution Image Viewer
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            A web application for managing and viewing high-resolution pathology images, built by
            BCIT TLU.
          </Typography>
          <Divider sx={{ my: 1.5 }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0.75 }}>
            {(
              [
                ['Frontend', frontendVersion ?? 'dev'],
                ['Backend', backendVersion ?? '...'],
                ['Backup', backupVersion ?? '...'],
              ] as const
            ).flatMap(([label, value]) => [
              <Typography key={`${label}-label`} variant="caption" color="text.secondary">
                {label}
              </Typography>,
              <Typography key={`${label}-value`} variant="caption">
                {value}
              </Typography>,
            ])}
          </Box>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" color="text.secondary">
            Licensed under the{' '}
            <Link
              href="https://github.com/bcit-tlu/hriv/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
            >
              Mozilla Public License 2.0
            </Link>
            . Built with{' '}
            <Link href="/THIRD-PARTY-LICENSES.txt" target="_blank" rel="noopener noreferrer">
              third-party open-source software
            </Link>
            .
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAboutOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
