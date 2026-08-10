import {
  useEffect,
  useMemo,
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
import Collapse from '@mui/material/Collapse'
import Container from '@mui/material/Container'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Drawer from '@mui/material/Drawer'
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
import ListSubheader from '@mui/material/ListSubheader'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
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
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto'
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts'
import LogoutIcon from '@mui/icons-material/Logout'
import ColorModeToggle from './ColorModeToggle'
import FooterBar from './FooterBar'
import AnnouncementBanner from './AnnouncementBanner'
import type { Role } from '../types'
import { useColorMode } from '../useColorMode'
import { useIsMobile } from '../useIsMobile'
import {
  appBarAvatarSx,
  appBarClusterGap,
  appBarIconButtonSx,
  cappedRowSx,
  getGroupChipColors,
} from '../theme'

export type Page = 'browse' | 'manage' | 'people' | 'admin'

export interface AppShellProps {
  page: Page
  onTabChange: (page: Page) => void
  onHomeClick: () => void
  /** Whether there's a level to go back up to (inside a category, or viewing an
   *  image). Drives the mobile back arrow. */
  canGoBack?: boolean
  /** Navigate one level up. Mobile only. */
  onBack?: () => void
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
    canGoBack = false,
    onBack,
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
  // Collapse the nav tabs into a hamburger menu when the viewport is too
  // narrow to show them inline. Guarded by tab count so a single-tab
  // (student) layout keeps its inline Home tab instead of a lone hamburger.
  const isCompactViewport = useMediaQuery(theme.breakpoints.down('md'))
  const isMobile = useIsMobile()
  const navTabCount = 1 + (canEditContent ? 2 : 0) + (canManageUsers ? 2 : 0)
  const collapseNav = isCompactViewport && navTabCount > 1
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- close drawer after viewport expands
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
  // Program/group pills describe access control, which is staff-facing detail.
  // Students don't see their own; admins and instructors still do.
  const showOwnRestrictionChips = currentUser.role !== 'student'
  const groupColors = getGroupChipColors(mode)
  const { preference: themePreference, toggleMode } = useColorMode()
  const themeIcon = useMemo(() => {
    if (themePreference === 'light') return <LightModeIcon fontSize="small" />
    if (themePreference === 'dark') return <DarkModeIcon fontSize="small" />
    return <BrightnessAutoIcon fontSize="small" />
  }, [themePreference])
  const themeLabel = useMemo(() => {
    if (themePreference === 'light') return 'Theme: Light'
    if (themePreference === 'dark') return 'Theme: Dark'
    return 'Theme: Auto'
  }, [themePreference])

  // Home navigation shared by the brand lockup, the Home tab and the collapsed
  // menu's Home item: switch to browse, or — when already there — reset to the
  // category root and refresh.
  const goHome = () => (page === 'browse' ? onHomeClick() : onTabChange('browse'))

  // Inside a category (or an image) the design swaps the brand lockup for a
  // back arrow on mobile. Only in the inline-tab layout — the collapsed-nav
  // layout already owns the start slot with its hamburger.
  const showBack = isMobile && !collapseNav && canGoBack && Boolean(onBack)

  // Profile popover action rows are tighter on mobile: less vertical padding per
  // row (so View Announcement / Logout sit closer) and a smaller gap above and
  // below the block. Desktop keeps the roomier spacing.
  const profileItemPy = isMobile ? 0.5 : 1.25
  // MUI MenuItem has a 48px min-height that otherwise dominates the row and keeps
  // the items far apart regardless of padding; shrink it on mobile.
  const profileItemMinH = isMobile ? 36 : undefined
  const profileMenuMt = isMobile ? 0.75 : 1.5
  const profileMenuPb = isMobile ? 0.5 : 1

  // Collapsed-nav menu, built as ordered sections. Empty sections are dropped
  // and dividers are only inserted *between* non-empty sections, so the menu
  // stays correct for any role combination (no leading/trailing/double
  // dividers even if the role invariants change).
  const renderNavMenuItems = () => {
    const closeThen = (fn: () => void) => () => {
      setNavDrawerOpen(false)
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
      makeItem('browse', 'Home', <HomeIcon fontSize="small" />, goHome, page === 'browse'),
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
      {/* Announcement banner — sits above the app bar so it reads as a
          site-wide notice, on every page and at every width (per the design).
          Mobile spans edge-to-edge; desktop keeps the capped row so the text
          starts at the same x as the logo and tabs directly beneath it. */}
      {announcement && (
        <Collapse in={!annCollapsed} onExited={onDismissAnnouncement}>
          <Box data-testid="announcement-row">
            {isMobile ? (
              <AnnouncementBanner
                message={announcement}
                onDismiss={onDismissAnnouncement ? () => setAnnCollapsed(true) : undefined}
              />
            ) : (
              <Container maxWidth={false} sx={cappedRowSx}>
                <AnnouncementBanner
                  message={announcement}
                  onDismiss={onDismissAnnouncement ? () => setAnnCollapsed(true) : undefined}
                />
              </Container>
            )}
          </Box>
        </Collapse>
      )}

      {/* App bar — the bar itself stays full-bleed; its contents are capped so
          the logo and tabs line up with the content column below. */}
      <AppBar position="static" elevation={1}>
        <Toolbar sx={cappedRowSx}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 0.5, sm: 0.75 },
              mr: { xs: 1, sm: 2 },
            }}
          >
            {collapseNav && (
              <Tooltip title="Menu">
                <IconButton
                  edge="start"
                  onClick={() => setNavDrawerOpen(true)}
                  sx={{ color: 'inherit', mr: -1, ...appBarIconButtonSx }}
                  aria-label="Open navigation menu"
                  aria-haspopup="true"
                  aria-expanded={navDrawerOpen}
                >
                  <MenuIcon />
                </IconButton>
              </Tooltip>
            )}
            {showBack ? (
              /* Inside a category / image the design replaces the brand lockup
                 with a back arrow, keeping the narrow bar uncluttered. */
              <Tooltip title="Back">
                <IconButton
                  edge="start"
                  onClick={onBack}
                  sx={{ color: 'inherit', ...appBarIconButtonSx }}
                  aria-label="Go back"
                >
                  <ArrowBackIcon />
                </IconButton>
              </Tooltip>
            ) : (
              /* Brand mark doubles as the home link, matching the design (and
                 the near-universal convention). The button lives *inside* the
                 h1 so the page keeps its heading while the whole lockup — logo
                 and wordmark — is clickable. The logo's alt is empty because
                 the adjacent text already names it. */
              <Typography variant="h6" component="h1" sx={{ display: 'flex', m: 0 }}>
                <Tooltip title="Home">
                  <Box
                    component="button"
                    type="button"
                    onClick={goHome}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: { xs: 0.5, sm: 0.75 },
                      background: 'none',
                      border: 'none',
                      p: 0,
                      cursor: 'pointer',
                      color: 'inherit',
                      font: 'inherit',
                      letterSpacing: 'inherit',
                      fontSize: { xs: '1.05rem', sm: 'inherit' },
                    }}
                  >
                    <Box
                      component="img"
                      src="/favicon.svg"
                      alt=""
                      sx={{ height: { xs: 28, sm: 32 }, width: { xs: 28, sm: 32 } }}
                    />
                    HRIV
                  </Box>
                </Tooltip>
              </Typography>
            )}
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
              sx={{
                flexGrow: 1,
                '& .MuiTab-root': {
                  fontSize: { xs: 13, sm: 14 },
                  minWidth: { xs: 'auto', sm: 90 },
                  px: { xs: 1.25, sm: 2 },
                },
              }}
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
          {collapseNav && (
            <Drawer anchor="left" open={navDrawerOpen} onClose={() => setNavDrawerOpen(false)}>
              <Box sx={{ width: 'min(82vw, 300px)', maxWidth: '100%' }} role="presentation">
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    pl: 2,
                    pr: 1,
                    pt: 1.5,
                    pb: 1.5,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      component="img"
                      src="/favicon.svg"
                      alt="HRIV"
                      sx={{ height: 32, width: 32 }}
                    />
                    <Typography variant="h6" component="span">
                      HRIV
                    </Typography>
                  </Box>
                  <Tooltip title="Close menu">
                    <IconButton
                      onClick={() => setNavDrawerOpen(false)}
                      aria-label="Close navigation menu"
                    >
                      <CloseIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Divider />
                <MenuList sx={{ pt: 1 }}>{renderNavMenuItems()}</MenuList>
              </Box>
            </Drawer>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: appBarClusterGap }}>
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
            <IconButton
              ref={avatarRef}
              onClick={() => setProfileOpen(true)}
              sx={{ p: 0, minWidth: { xs: 36, sm: 40 }, minHeight: { xs: 36, sm: 40 } }}
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
              <Card sx={{ minWidth: 240 }}>
                <CardContent sx={{ '&:last-child': { pb: profileMenuPb } }}>
                  <Typography sx={{ fontWeight: 600, fontSize: 17, lineHeight: 1.35 }}>
                    {currentUser.name}
                  </Typography>
                  <Typography color="text.secondary" sx={{ fontSize: 15, mt: 0.25 }}>
                    {currentUser.email}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ fontSize: 15, textTransform: 'capitalize' }}
                  >
                    {currentUser.role}
                  </Typography>
                  {showOwnRestrictionChips && currentUser.program_names.length > 0 && (
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
                  {showOwnRestrictionChips && currentUser.group_names.length > 0 && (
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
                  <Divider sx={{ mt: profileMenuMt, mx: -2 }} />
                  {/* MenuItem styles `.MuiListItemIcon-root` with a descendant
                      selector (min-width: 36px), which outranks an `sx` on the
                      icon itself — so the collapse has to happen from here.
                      The label's own `ml` then sets the icon-to-text gap. */}
                  <MenuList sx={{ mx: -2, py: 0, '& .MuiListItemIcon-root': { minWidth: 0 } }}>
                    {collapseNav && (
                      <MenuItem sx={{ py: profileItemPy, minHeight: profileItemMinH }} onClick={() => toggleMode()}>
                        <ListItemIcon sx={{ minWidth: 0, mr: 0 }}>{themeIcon}</ListItemIcon>
                        <ListItemText
                          slotProps={{ primary: { fontSize: 15 } }}
                          sx={{ my: 0, ml: 1 }}
                        >
                          {themeLabel}
                        </ListItemText>
                      </MenuItem>
                    )}
                    {canManageUsers && (
                      <MenuItem sx={{ py: profileItemPy, minHeight: profileItemMinH }} onClick={() => openEditProfile()}>
                        <ListItemIcon sx={{ minWidth: 0, mr: 0 }}>
                          <ManageAccountsIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          slotProps={{ primary: { fontSize: 15 } }}
                          sx={{ my: 0, ml: 1 }}
                        >
                          Update
                        </ListItemText>
                      </MenuItem>
                    )}
                    {showViewAnnLink && (
                      <MenuItem
                        sx={{ py: profileItemPy, minHeight: profileItemMinH }}
                        onClick={() => {
                          setProfileOpen(false)
                          setViewAnnOpen(true)
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 0, mr: 0 }}>
                          <CampaignIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          slotProps={{ primary: { fontSize: 15 } }}
                          sx={{ my: 0, ml: 1 }}
                        >
                          View Announcement
                        </ListItemText>
                      </MenuItem>
                    )}
                    <MenuItem
                      sx={{ py: profileItemPy, minHeight: profileItemMinH }}
                      onClick={() => {
                        setProfileOpen(false)
                        logout()
                      }}
                    >
                      {/* Neutral rather than the salmon accent, matching the
                          rest of the chrome. `gap` sets the icon-to-label
                          spacing; ListItemText also carries its own default
                          margin, which is what left the icon stranded. */}
                      <ListItemIcon sx={{ minWidth: 0, mr: 0, color: 'text.secondary' }}>
                        <LogoutIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText slotProps={{ primary: { fontSize: 15 } }} sx={{ my: 0, ml: 1 }}>
                        Logout
                      </ListItemText>
                    </MenuItem>
                  </MenuList>
                </CardContent>
              </Card>
            </Popover>
          </Box>
        </Toolbar>
      </AppBar>

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
