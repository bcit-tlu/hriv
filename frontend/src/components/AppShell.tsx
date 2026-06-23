import { useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Collapse from '@mui/material/Collapse'
import Container from '@mui/material/Container'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Popover from '@mui/material/Popover'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import ListSubheader from '@mui/material/ListSubheader'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
import HomeIcon from '@mui/icons-material/Home'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import FolderIcon from '@mui/icons-material/Folder'
import SchoolIcon from '@mui/icons-material/School'
import GroupsIcon from '@mui/icons-material/Groups'
import CampaignIcon from '@mui/icons-material/Campaign'
import PeopleIcon from '@mui/icons-material/People'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import ColorModeToggle from './ColorModeToggle'
import FooterBar from './FooterBar'
import AnnouncementBanner from './AnnouncementBanner'
import type { Role } from '../types'
import {
  appBarAvatarSx,
  appBarClusterGap,
  appBarIconButtonSx,
  getGroupChipColors,
  getSurfaceVariant,
} from '../theme'

export type Page = 'browse' | 'manage' | 'people' | 'admin'

export interface AppShellProps {
  page: Page
  onTabChange: (page: Page) => void
  onHomeClick: () => void
  canEditContent: boolean
  canManageUsers: boolean
  currentUser: {
    name: string
    email: string
    role: Role
    program_names: string[]
    group_names: string[]
  }
  announcement: string
  annMessage: string
  annEnabled: boolean
  onDismissAnnouncement?: () => void
  // Profile popover
  profileOpen: boolean
  setProfileOpen: Dispatch<SetStateAction<boolean>>
  avatarRef: RefObject<HTMLButtonElement | null>
  openEditProfile: () => void
  logout: () => void
  // Manage menu
  onOpenCategories: () => void
  onOpenPrograms: () => void
  onOpenGroups: () => void
  onOpenAnnouncement: () => void
  // Search
  onSearchOpen: () => void
  // Footer
  mode: 'light' | 'dark'
  frontendVersion: string | null
  backendVersion: string | null
  backupVersion: string | null
  onReportIssue: () => void
  notificationSlot?: ReactNode
  // Children (main content)
  children: ReactNode
}

export default function AppShell(props: AppShellProps) {
  const {
    page,
    onTabChange,
    onHomeClick,
    canEditContent,
    canManageUsers,
    currentUser,
    announcement,
    annMessage,
    annEnabled,
    onDismissAnnouncement,
    profileOpen,
    setProfileOpen,
    avatarRef,
    openEditProfile,
    logout,
    onOpenCategories,
    onOpenPrograms,
    onOpenGroups,
    onOpenAnnouncement,
    onSearchOpen,
    mode,
    frontendVersion,
    backendVersion,
    backupVersion,
    onReportIssue,
    notificationSlot,
    children,
  } = props
  const [manageMenuAnchor, setManageMenuAnchor] = useState<HTMLElement | null>(null)
  const [navMenuAnchor, setNavMenuAnchor] = useState<HTMLElement | null>(null)
  const theme = useTheme()
  // Collapse the nav tabs into a hamburger menu when the viewport is too
  // narrow to show them inline. Guarded by tab count so a single-tab
  // (student) layout keeps its inline Home tab instead of a lone hamburger.
  const isCompactViewport = useMediaQuery(theme.breakpoints.down('md'))
  const navTabCount = 1 + (canEditContent ? 2 : 0) + (canManageUsers ? 2 : 0)
  const collapseNav = isCompactViewport && navTabCount > 1
  const [viewAnnOpen, setViewAnnOpen] = useState(false)
  const [annCollapsed, setAnnCollapsed] = useState(false)
  const [prevAnnouncement, setPrevAnnouncement] = useState(announcement)
  if (announcement !== prevAnnouncement) {
    setPrevAnnouncement(announcement)
    if (announcement) setAnnCollapsed(false)
  }
  const showViewAnnLink = annEnabled && !announcement
  const contentBg = page === 'people' || page === 'admin' ? getSurfaceVariant(mode) : undefined
  const groupColors = getGroupChipColors(mode)

  // Collapsed-nav menu, built as ordered sections. Empty sections are dropped
  // and dividers are only inserted *between* non-empty sections, so the menu
  // stays correct for any role combination (no leading/trailing/double
  // dividers even if the role invariants change).
  const renderNavMenuItems = () => {
    const closeThen = (fn: () => void) => () => {
      setNavMenuAnchor(null)
      fn()
    }
    // Icon + text per MUI's Menu composition (ListItemIcon + ListItemText).
    // Icons give the tappable items a clear visual structure, so the icon-less
    // uppercased ListSubheader unambiguously reads as a section label.
    const makeItem = (
      key: string,
      label: string,
      icon: ReactNode,
      onClick: () => void,
      selected = false,
    ) => (
      <MenuItem key={key} selected={selected} onClick={closeThen(onClick)}>
        <ListItemIcon sx={{ minWidth: 36 }}>{icon}</ListItemIcon>
        <ListItemText>{label}</ListItemText>
      </MenuItem>
    )
    const sections: ReactNode[][] = []

    const pages: ReactNode[] = [
      makeItem(
        'browse',
        'Home',
        <HomeIcon fontSize="small" />,
        () => (page === 'browse' ? onHomeClick() : onTabChange('browse')),
        page === 'browse',
      ),
    ]
    if (canEditContent) {
      pages.push(
        makeItem(
          'manage',
          'Images',
          <PhotoLibraryIcon fontSize="small" />,
          () => onTabChange('manage'),
          page === 'manage',
        ),
      )
    }
    sections.push(pages)

    if (canEditContent) {
      const manage: ReactNode[] = [
        <ListSubheader
          key="manage-header"
          sx={{
            bgcolor: 'transparent',
            lineHeight: '36px',
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            fontWeight: 700,
            fontSize: '0.875rem',
            color: 'text.secondary',
          }}
        >
          Manage
        </ListSubheader>,
        makeItem('categories', 'Categories', <FolderIcon fontSize="small" />, onOpenCategories),
      ]
      if (canManageUsers) {
        manage.push(
          makeItem('programs', 'Programs', <SchoolIcon fontSize="small" />, onOpenPrograms),
        )
      }
      manage.push(
        makeItem('groups', 'Groups', <GroupsIcon fontSize="small" />, onOpenGroups),
        makeItem(
          'announcement',
          'Announcement',
          <CampaignIcon fontSize="small" />,
          onOpenAnnouncement,
        ),
      )
      sections.push(manage)
    }

    if (canManageUsers) {
      sections.push([
        makeItem(
          'people',
          'People',
          <PeopleIcon fontSize="small" />,
          () => onTabChange('people'),
          page === 'people',
        ),
        makeItem(
          'admin',
          'Admin',
          <AdminPanelSettingsIcon fontSize="small" />,
          () => onTabChange('admin'),
          page === 'admin',
        ),
      ])
    }

    return sections.flatMap((items, i) =>
      i === 0 ? items : [<Divider key={`nav-divider-${i}`} />, ...items],
    )
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
      }}
    >
      {/* App bar */}
      <AppBar position="static" elevation={1}>
        <Toolbar>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mr: 2,
            }}
          >
            <Box component="img" src="/favicon.svg" alt="HRIV" sx={{ height: 32, width: 32 }} />
            <Typography variant="h6" component="h1">
              HRIV
            </Typography>
          </Box>
          {collapseNav ? (
            <Box sx={{ flexGrow: 1 }} />
          ) : (
            <Tabs
              value={page}
              onChange={(_, v: Page) => {
                if (v === 'browse' || v === 'manage' || v === 'people' || v === 'admin') {
                  onTabChange(v)
                }
              }}
              textColor="inherit"
              TabIndicatorProps={{
                style: { backgroundColor: 'white' },
              }}
              sx={{ flexGrow: 1 }}
            >
              <Tab
                label="Home"
                value="browse"
                onClick={() => {
                  // Only fire when already on browse (refresh/reset);
                  // otherwise Tabs onChange handles the page switch.
                  if (page === 'browse') {
                    onHomeClick()
                  }
                }}
              />
              {canEditContent && <Tab label="Images" value="manage" />}
              {canEditContent && (
                <Tab
                  label="Manage"
                  value={false}
                  onClick={(e) => setManageMenuAnchor(e.currentTarget)}
                />
              )}
              {canManageUsers && <Tab label="People" value="people" />}
              {canManageUsers && <Tab label="Admin" value="admin" />}
            </Tabs>
          )}
          {!collapseNav && (
            <Menu
              anchorEl={manageMenuAnchor}
              open={Boolean(manageMenuAnchor)}
              onClose={() => setManageMenuAnchor(null)}
            >
              <MenuItem
                onClick={() => {
                  setManageMenuAnchor(null)
                  onOpenCategories()
                }}
              >
                Categories
              </MenuItem>
              {canManageUsers && (
                <MenuItem
                  onClick={() => {
                    setManageMenuAnchor(null)
                    onOpenPrograms()
                  }}
                >
                  Programs
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  setManageMenuAnchor(null)
                  onOpenGroups()
                }}
              >
                Groups
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setManageMenuAnchor(null)
                  onOpenAnnouncement()
                }}
              >
                Announcement
              </MenuItem>
            </Menu>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: appBarClusterGap }}>
            {collapseNav && (
              <Tooltip title="Menu">
                <IconButton
                  onClick={(e) => setNavMenuAnchor(e.currentTarget)}
                  sx={{ color: 'inherit', ...appBarIconButtonSx }}
                  aria-label="Open navigation menu"
                  aria-haspopup="true"
                  aria-expanded={Boolean(navMenuAnchor)}
                >
                  <MenuIcon />
                </IconButton>
              </Tooltip>
            )}
            {collapseNav && (
              <Menu
                anchorEl={navMenuAnchor}
                open={Boolean(navMenuAnchor)}
                onClose={() => setNavMenuAnchor(null)}
              >
                {renderNavMenuItems()}
              </Menu>
            )}
            <ColorModeToggle iconButtonSx={{ color: 'inherit', ...appBarIconButtonSx }} />
            <Tooltip title="Search">
              <IconButton
                onClick={onSearchOpen}
                sx={{ color: 'inherit', ...appBarIconButtonSx }}
                aria-label="Search"
              >
                <SearchIcon />
              </IconButton>
            </Tooltip>
            {notificationSlot}
            <IconButton ref={avatarRef} onClick={() => setProfileOpen(true)} sx={{ p: 0, ml: 0.5 }}>
              <Avatar
                sx={{
                  ...appBarAvatarSx,
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
              // eslint-disable-next-line react-hooks/refs -- MUI Popover requires DOM element; ref is always populated before open=true
              anchorEl={avatarRef.current}
              onClose={() => setProfileOpen(false)}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
            >
              <Card sx={{ minWidth: 240 }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {currentUser.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {currentUser.email}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ textTransform: 'capitalize' }}
                  >
                    {currentUser.role}
                  </Typography>
                  {currentUser.program_names.length > 0 && (
                    <Box
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 0.5,
                        mt: 0.5,
                      }}
                    >
                      {currentUser.program_names.map((name) => (
                        <Chip key={name} label={name} size="small" color="primary" />
                      ))}
                    </Box>
                  )}
                  {currentUser.group_names.length > 0 && (
                    <Box
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 0.5,
                        mt: 0.5,
                      }}
                    >
                      {currentUser.group_names.map((name) => (
                        <Chip
                          key={name}
                          label={name}
                          size="small"
                          sx={{
                            bgcolor: groupColors.solidBg,
                            color: groupColors.solidText,
                          }}
                        />
                      ))}
                    </Box>
                  )}
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent:
                        canManageUsers || showViewAnnLink ? 'space-between' : 'flex-end',
                      mt: 2,
                      gap: 2,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      {canManageUsers && (
                        <Link
                          component="button"
                          variant="body2"
                          onClick={() => {
                            openEditProfile()
                          }}
                        >
                          Update
                        </Link>
                      )}
                      {showViewAnnLink && (
                        <Link
                          component="button"
                          variant="body2"
                          onClick={() => {
                            setProfileOpen(false)
                            setViewAnnOpen(true)
                          }}
                        >
                          View Announcement
                        </Link>
                      )}
                    </Box>
                    <Link
                      component="button"
                      variant="body2"
                      color="primary"
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
      {announcement && (
        <Collapse in={!annCollapsed} onExited={onDismissAnnouncement}>
          <Box
            sx={{
              bgcolor: contentBg,
              pt: 2.5,
            }}
          >
            <Container maxWidth={false} sx={{ px: { xs: 2, sm: 3, lg: '72px', xl: '120px' } }}>
              <AnnouncementBanner
                message={announcement}
                onDismiss={onDismissAnnouncement ? () => setAnnCollapsed(true) : undefined}
              />
            </Container>
          </Box>
        </Collapse>
      )}

      {/* Read-only announcement dialog (for dismissed announcements) */}
      <Dialog open={viewAnnOpen} onClose={() => setViewAnnOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Announcement</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mt: 1 }}>
            {annMessage}
          </Alert>
        </DialogContent>
      </Dialog>

      {/* Main content */}
      {children}

      <FooterBar
        canManageUsers={canManageUsers}
        frontendVersion={frontendVersion || undefined}
        backendVersion={backendVersion ?? undefined}
        backupVersion={backupVersion ?? undefined}
        onReportIssue={onReportIssue}
      />
    </Box>
  )
}
