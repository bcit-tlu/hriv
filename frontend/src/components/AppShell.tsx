import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Container from '@mui/material/Container'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import Popover from '@mui/material/Popover'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import HomeIcon from '@mui/icons-material/Home'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import FolderIcon from '@mui/icons-material/Folder'
import SchoolIcon from '@mui/icons-material/School'
import GroupsIcon from '@mui/icons-material/Groups'
import CampaignIcon from '@mui/icons-material/Campaign'
import PeopleIcon from '@mui/icons-material/People'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts'
import LogoutIcon from '@mui/icons-material/Logout'
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
  const [navDrawerOpen, setNavDrawerOpen] = useState(false)
  const theme = useTheme()
  // Collapse the whole nav (tabs + profile) into a left drawer behind a
  // hamburger whenever the viewport is compact — for every role, so the mobile
  // layout is consistent (students get the same hamburger + drawer as everyone
  // else, with just the Home tab inside).
  const isCompactViewport = useMediaQuery(theme.breakpoints.down('md'))
  const collapseNav = isCompactViewport
  // Reset the breakpoint-specific menus on a viewport transition so a resize
  // round-trip doesn't leave one open against an unmounted trigger:
  //  - desktop → the drawer can't apply, so close it;
  //  - compact → the Manage tab (and its dropdown) unmount, so drop the stale
  //    anchor that would otherwise reopen the menu against a detached node.
  const isInitialViewportRun = useRef(true)
  useEffect(() => {
    // Skip the initial mount — state already matches the viewport. Only act on
    // an actual breakpoint transition.
    if (isInitialViewportRun.current) {
      isInitialViewportRun.current = false
      return
    }
    if (collapseNav) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale anchor after viewport collapse
      setManageMenuAnchor(null)
    } else {
      setNavDrawerOpen(false)
    }
  }, [collapseNav])
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
  const isStudent = currentUser.role === 'student'
  // Standard iOS tuning for SwipeableDrawer (native-feeling open/close).
  const iOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

  // Collapsed-nav menu: every destination in a single flat group — no section
  // subheaders or dividers — so the whole nav reads as one list on mobile.
  const renderNavMenuItems = () => {
    const closeThen = (fn: () => void) => () => {
      setNavDrawerOpen(false)
      fn()
    }
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
    const items: ReactNode[] = [
      makeItem(
        'browse',
        'Home',
        <HomeIcon fontSize="small" />,
        () => (page === 'browse' ? onHomeClick() : onTabChange('browse')),
        page === 'browse',
      ),
    ]
    if (canEditContent) {
      items.push(
        makeItem(
          'manage',
          'Images',
          <PhotoLibraryIcon fontSize="small" />,
          () => onTabChange('manage'),
          page === 'manage',
        ),
        makeItem('categories', 'Categories', <FolderIcon fontSize="small" />, onOpenCategories),
      )
    }
    if (canManageUsers) {
      items.push(makeItem('programs', 'Programs', <SchoolIcon fontSize="small" />, onOpenPrograms))
    }
    if (canEditContent) {
      items.push(
        makeItem('groups', 'Groups', <GroupsIcon fontSize="small" />, onOpenGroups),
        makeItem(
          'announcement',
          'Announcement',
          <CampaignIcon fontSize="small" />,
          onOpenAnnouncement,
        ),
      )
    }
    if (canManageUsers) {
      items.push(
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
      )
    }
    return items
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
        <Toolbar sx={{ position: 'relative' }}>
          {collapseNav ? (
            <>
              {/* Left: hamburger opens the nav drawer */}
              <Tooltip title="Menu">
                <IconButton
                  edge="start"
                  onClick={() => setNavDrawerOpen(true)}
                  sx={{ color: 'inherit', ...appBarIconButtonSx }}
                  aria-label="Open navigation menu"
                  aria-haspopup="true"
                  aria-expanded={navDrawerOpen}
                >
                  <MenuIcon />
                </IconButton>
              </Tooltip>
              {/* Center: logo + brand, absolutely centered regardless of the
                  surrounding cluster widths. pointerEvents:none so it never
                  swallows taps meant for the icons on either side. */}
              <Box
                sx={{
                  position: 'absolute',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  pointerEvents: 'none',
                }}
              >
                <Box component="img" src="/favicon.svg" alt="HRIV" sx={{ height: 32, width: 32 }} />
                <Typography variant="h6" component="h1">
                  HRIV
                </Typography>
              </Box>
              <Box sx={{ flexGrow: 1 }} />
            </>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mr: 2 }}>
                <Box component="img" src="/favicon.svg" alt="HRIV" sx={{ height: 32, width: 32 }} />
                <Typography variant="h6" component="h1">
                  HRIV
                </Typography>
              </Box>
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
            </>
          )}
          {collapseNav && (
            <SwipeableDrawer
              anchor="left"
              open={navDrawerOpen}
              onOpen={() => setNavDrawerOpen(true)}
              onClose={() => setNavDrawerOpen(false)}
              disableBackdropTransition={!iOS}
              disableDiscovery={iOS}
            >
              <Box
                sx={{
                  width: 'min(82vw, 300px)',
                  maxWidth: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                role="presentation"
              >
                {/* Profile content at the top. The name shares a vertically
                    centered row with the close (×) so the icon lines up with the
                    name line. */}
                <Box data-testid="drawer-profile" sx={{ pl: 2, pr: 1, pt: 1, pb: 1.5 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Typography sx={{ fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.3 }}>
                      {currentUser.name}
                    </Typography>
                    <Tooltip title="Close menu">
                      <IconButton
                        onClick={() => setNavDrawerOpen(false)}
                        aria-label="Close navigation menu"
                        sx={{ mr: 0.25 }}
                      >
                        <CloseIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Typography color="text.secondary" sx={{ fontSize: '1rem' }}>
                    {currentUser.email}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ fontSize: '1rem', textTransform: 'lowercase' }}
                  >
                    {currentUser.role}
                  </Typography>
                  {/* Program/group chips are shown for staff roles only. */}
                  {!isStudent && currentUser.program_names.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {currentUser.program_names.map((name) => (
                        <Chip key={name} label={name} size="small" color="primary" />
                      ))}
                    </Box>
                  )}
                  {!isStudent && currentUser.group_names.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {currentUser.group_names.map((name) => (
                        <Chip
                          key={name}
                          label={name}
                          size="small"
                          sx={{ bgcolor: groupColors.solidBg, color: groupColors.solidText }}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
                <Divider />
                {/* Navigation tabs */}
                <MenuList sx={{ pt: 1 }}>{renderNavMenuItems()}</MenuList>
                {/* Secondary actions below the tabs. Read-only announcement
                    access is available to everyone (students included) whenever
                    an announcement is configured; posting/editing stays gated
                    behind the Announcement nav item above (staff only). */}
                {(canManageUsers || annEnabled) && (
                  <MenuList sx={{ py: 0 }}>
                    {canManageUsers && (
                      <MenuItem
                        sx={{ py: 1.25 }}
                        onClick={() => {
                          setNavDrawerOpen(false)
                          openEditProfile()
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <ManageAccountsIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Update</ListItemText>
                      </MenuItem>
                    )}
                    {annEnabled && (
                      <MenuItem
                        sx={{ py: 1.25 }}
                        onClick={() => {
                          setNavDrawerOpen(false)
                          setViewAnnOpen(true)
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <CampaignIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>View Announcement</ListItemText>
                      </MenuItem>
                    )}
                  </MenuList>
                )}
                {/* Foot of the drawer: Logout on the left, theme toggle (icon
                    only) on the right, pinned to the bottom via mt: auto. */}
                <Box
                  sx={{
                    mt: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 1,
                    py: 1,
                    borderTop: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Button
                    onClick={() => {
                      setNavDrawerOpen(false)
                      logout()
                    }}
                    startIcon={<LogoutIcon />}
                    sx={{
                      color: 'primary.main',
                      textTransform: 'none',
                      fontSize: '1.05rem',
                      '& .MuiButton-startIcon > *': { fontSize: 26 },
                    }}
                  >
                    Logout
                  </Button>
                  <ColorModeToggle />
                </Box>
              </Box>
            </SwipeableDrawer>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: appBarClusterGap }}>
            {/* Desktop keeps the theme toggle in the bar; on mobile it lives in
                the drawer under the profile section. Search stays here always. */}
            {!collapseNav && (
              <ColorModeToggle iconButtonSx={{ color: 'inherit', ...appBarIconButtonSx }} />
            )}
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
            {/* Profile is in the drawer on mobile; the avatar + popover are desktop-only. */}
            {!collapseNav && (
              <>
                <IconButton
                  ref={avatarRef}
                  onClick={() => setProfileOpen(true)}
                  sx={{ p: 0, minWidth: 40, minHeight: 40 }}
                >
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
                  <Card data-testid="user-card" sx={{ minWidth: 240, maxWidth: 280 }}>
                    <CardContent sx={{ '&:last-child': { pb: 1 } }}>
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
                      <Divider sx={{ mt: 1.5, mx: -2 }} />
                      <MenuList sx={{ mx: -2, py: 0 }}>
                        {canManageUsers && (
                          <MenuItem sx={{ py: 1.25 }} onClick={() => openEditProfile()}>
                            <ListItemIcon sx={{ minWidth: 0, mr: 1.25 }}>
                              <ManageAccountsIcon fontSize="small" />
                            </ListItemIcon>
                            <ListItemText>Update</ListItemText>
                          </MenuItem>
                        )}
                        {showViewAnnLink && (
                          <MenuItem
                            sx={{ py: 1.25 }}
                            onClick={() => {
                              setProfileOpen(false)
                              setViewAnnOpen(true)
                            }}
                          >
                            <ListItemIcon sx={{ minWidth: 0, mr: 1.25 }}>
                              <CampaignIcon fontSize="small" />
                            </ListItemIcon>
                            <ListItemText>View Announcement</ListItemText>
                          </MenuItem>
                        )}
                        <MenuItem
                          sx={{ py: 1.25, color: 'primary.main' }}
                          onClick={() => {
                            setProfileOpen(false)
                            logout()
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 0, mr: 1.25, color: 'primary.main' }}>
                            <LogoutIcon fontSize="small" />
                          </ListItemIcon>
                          <ListItemText>Logout</ListItemText>
                        </MenuItem>
                      </MenuList>
                    </CardContent>
                  </Card>
                </Popover>
              </>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      {/* Announcement banner */}
      {announcement && (
        <Collapse in={!annCollapsed} onExited={onDismissAnnouncement}>
          <Box
            data-testid="announcement-banner"
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
