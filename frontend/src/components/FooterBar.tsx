import { Box, Link, Typography } from '@mui/material'
import { useColorMode } from '../useColorMode'
import { cappedRowSx, contentGutterPx } from '../theme'

const RELEASES_HREF = 'https://github.com/bcit-tlu/hriv/releases'
const REPO_HREF = 'https://github.com/bcit-tlu/hriv'

function Spacer() {
  return <Box component="span" sx={{ display: 'inline-block', width: '3ch' }} />
}

function hrefFor(version: string) {
  return version && version !== 'dev' ? RELEASES_HREF : REPO_HREF
}

function AdminVersions({
  frontendVersion,
  backendVersion,
  backupVersion,
}: {
  frontendVersion?: string
  backendVersion?: string
  backupVersion?: string
}) {
  const entries = [
    {
      label: 'Frontend',
      display: frontendVersion || 'dev',
      linkValue: frontendVersion || 'dev',
    },
    {
      label: 'Backend',
      display: backendVersion ?? '…',
      linkValue: backendVersion ?? '',
    },
    {
      label: 'Backup',
      display: backupVersion ?? '…',
      linkValue: backupVersion ?? '',
    },
  ]

  return (
    <>
      {entries.map(({ label, display, linkValue }) => (
        <span key={label}>
          <Spacer />
          <strong>{label}:</strong>{' '}
          <Link
            href={hrefFor(linkValue)}
            target="_blank"
            rel="noopener noreferrer"
            color="text.secondary"
            underline="hover"
          >
            {display}
          </Link>
        </span>
      ))}
    </>
  )
}

export interface FooterBarProps {
  canManageUsers: boolean
  frontendVersion?: string
  backendVersion?: string
  backupVersion?: string
  onReportIssue?: () => void
  /** Let the footer text span the full viewport instead of aligning with the
   *  capped content column. Used on the login screen, which has no capped
   *  content to line up with. */
  fullWidth?: boolean
}

export default function FooterBar({
  canManageUsers,
  frontendVersion,
  backendVersion,
  backupVersion,
  onReportIssue,
  fullWidth = false,
}: FooterBarProps) {
  const { mode } = useColorMode()

  return (
    <Box
      component="footer"
      sx={{
        bgcolor: mode === 'dark' ? 'background.paper' : 'background.default',
        borderTop: 1,
        borderColor: 'divider',
        flex: '0 0 auto',
      }}
    >
      {/* Inner row is capped so the text lines up with the content column
          instead of hugging the screen edges on wide monitors — unless the
          caller opts out (login screen, which has no capped content). */}
      <Box
        sx={{
          ...(fullWidth ? { width: '100%', px: contentGutterPx } : cappedRowSx),
          py: 1,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          <Link
            href={REPO_HREF}
            target="_blank"
            rel="noopener noreferrer"
            color="text.secondary"
            underline="hover"
          >
            High Resolution Image Viewer
          </Link>
          {canManageUsers && (
            <AdminVersions
              frontendVersion={frontendVersion}
              backendVersion={backendVersion}
              backupVersion={backupVersion}
            />
          )}
        </Typography>
        {onReportIssue && (
          <Link
            component="button"
            variant="caption"
            color="text.secondary"
            underline="hover"
            onClick={onReportIssue}
            sx={{ cursor: 'pointer' }}
          >
            Report issue
          </Link>
        )}
      </Box>
    </Box>
  )
}
