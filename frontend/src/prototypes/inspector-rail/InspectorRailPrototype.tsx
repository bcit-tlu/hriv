import { useEffect, useMemo, useRef, useState } from 'react'
import { alpha, createTheme, ThemeProvider, useTheme } from '@mui/material/styles'
import {
  Alert,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ChevronRight,
  CompassCalibration,
  InfoOutlined,
  Menu,
  PushPin,
  PushPinOutlined,
  Star,
  StarBorder,
} from '@mui/icons-material'
import ImageDetailsDrawer from '../../components/ImageDetailsDrawer'
import ImageInuksuksDrawer from '../../components/ImageInuksuksDrawer'
import InuksukFormDialog from '../../components/InuksukFormDialog'
import InuksukInfoCard from '../../components/InuksukInfoCard'
import { PROTOTYPE_BOARD, PROTOTYPE_ITEM as item } from './fixtures'
import { usePinnedDrawerState } from '../../usePinnedDrawerState'
import type { InuksukVisibilityPrefs } from '../../useInuksukVisibilityPrefs'

const items = [
  item,
  { ...item, id: 8, title: 'Surrounding tubules', favourite: false },
  {
    ...item,
    id: 9,
    title: 'Instructor reference — adjacent tubules and capsule',
    source: 'instructor' as const,
  },
]
const services = {
  fetchBoards: async () => [PROTOTYPE_BOARD],
  fetchBoard: async () => PROTOTYPE_BOARD,
  createBoard: async () => ({
    ...PROTOTYPE_BOARD,
    id: 2,
    name: 'New prototype Board',
    inuksuks: [],
  }),
  createInuksuk: async () => item,
  updateInuksuk: async () => item,
  deleteInuksuk: async () => {},
}
type Tab = 'Details' | 'Inuksuks'
type Visibility = { markerVisible: boolean; labelVisible: boolean }
const visible: Visibility = { markerVisible: true, labelVisible: true }

// Storybook-only adapters keep the production drawers and portals unchanged.
const embeddedDrawerSx = {
  position: 'relative',
  minHeight: 0,
  flex: 1,
  '& > aside': {
    position: 'relative',
    inset: 'auto',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    height: '100%',
    transform: 'none !important',
    boxShadow: 'none',
    backgroundImage: 'none',
    bgcolor: 'transparent',
  },
  '& > aside > :first-of-type': { display: 'none' },
} as const
const embeddedCardSx = {
  '& > [role="dialog"], & > section': {
    position: 'relative',
    inset: 'auto',
    width: '100%',
    maxWidth: '100%',
    maxHeight: 'none',
    boxShadow: 'none',
  },
} as const

export default function InspectorRailPrototype({
  placement = false,
  infoCard = false,
}: {
  placement?: boolean
  infoCard?: boolean
}) {
  const theme = useTheme()
  const formTheme = useMemo(
    () =>
      createTheme(theme, {
        components: {
          MuiCheckbox: {
            defaultProps: {
              icon: <StarBorder data-favourite-state="off" />,
              checkedIcon: <Star data-favourite-state="on" />,
            },
          },
        },
      }),
    [theme],
  )
  const { open, pinned, setOpen, setPinned } = usePinnedDrawerState(
    'storybook',
    'prototype-inspector-rail',
    false,
  )
  const [tab, setTab] = useState<Tab>('Details')
  const [draft, setDraft] = useState(placement)
  const [card, setCard] = useState(infoCard)
  const [message, setMessage] = useState('')
  const [visibility, setVisibility] = useState<Record<number, Visibility>>({})
  const [formHost, setFormHost] = useState<HTMLDivElement | null>(null)
  const [cardHost, setCardHost] = useState<HTMLDivElement | null>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const detailsTriggerRef = useRef<HTMLButtonElement>(null)
  const inuksuksTriggerRef = useRef<HTMLButtonElement>(null)
  const prefs: InuksukVisibilityPrefs = {
    groups: { mine: visible, instructor: visible, public: visible },
    visibilityFor: (row) => visibility[row.id] ?? visible,
    setItem: (row, field, value) =>
      setVisibility((current) => ({
        ...current,
        [row.id]: { ...(current[row.id] ?? visible), [field]: value },
      })),
    setGroup: (source, field, value) =>
      setVisibility((current) => {
        const next = { ...current }
        for (const row of items.filter((row) => row.source === source))
          next[row.id] = { ...(current[row.id] ?? visible), [field]: value }
        return next
      }),
  }
  useEffect(() => {
    if (!open || pinned) return
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (
        !(target instanceof Element) ||
        drawerRef.current?.contains(target) ||
        target.closest('.MuiAutocomplete-popper')
      )
        return
      setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open, pinned, setOpen])
  const toggle = (next: Tab) => {
    setOpen(!open || tab !== next)
    setTab(next)
  }
  const prototypeAction = () => setMessage('Prototype only — no changes are sent to the app.')
  const miniWidth = {
    xs: `calc(${theme.spacing(7)} + 1px)`,
    sm: `calc(${theme.spacing(8)} + 1px)`,
  }
  const drawerTransition = theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: open
      ? theme.transitions.duration.enteringScreen
      : theme.transitions.duration.leavingScreen,
  })
  return (
    <Stack spacing={1.5} sx={{ p: { xs: 1, sm: 2 }, height: '100vh', boxSizing: 'border-box' }}>
      <Box>
        <Typography variant="overline" color="primary">
          Design exploration · Storybook only
        </Typography>
        <Typography component="h1" variant="h6">
          Inspector rail / renal specimen
        </Typography>
      </Box>
      <Box
        data-testid="prototype-viewer"
        sx={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gridTemplateRows: {
            xs: open && pinned ? 'minmax(0, 2fr) minmax(0, 3fr)' : '1fr',
            sm: '1fr',
          },
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <Box
          data-testid="image-viewport"
          sx={{ position: 'relative', gridColumn: 1, gridRow: 1, minWidth: 0, minHeight: 0 }}
        >
          <Box
            component="button"
            type="button"
            aria-label="Image viewport"
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              border: 0,
              background: 'url(/hriv-splash2.jpg) center / cover',
              cursor: 'crosshair',
            }}
            onClick={() => setCard(false)}
          />
          {prefs.visibilityFor(item).markerVisible && (
            <IconButton
              aria-label="Inspect renal corpuscle"
              onClick={() => setCard(!card)}
              sx={{
                position: 'absolute',
                left: { xs: '12%', sm: '30%' },
                top: '42%',
                p: 0,
                width: 27,
                height: 27,
              }}
            >
              <Box component="img" src="/inuksuk-marker.svg" alt="" width={27} height={27} />
            </IconButton>
          )}
          <Box sx={{ position: 'absolute', bottom: 12, left: 12, display: 'flex' }}>
            {['zoomin', 'zoomout', 'home', 'rotateleft'].map((name) => (
              <Box
                key={name}
                component="img"
                src={`/openseadragon-svg-icons/${name}_rest.svg`}
                alt=""
                width={40}
                height={40}
              />
            ))}
          </Box>
          {card && (
            <Box
              ref={setCardHost}
              data-testid="marker-popover"
              sx={{
                ...embeddedCardSx,
                position: 'absolute',
                left: { xs: '8%', sm: 'calc(30% + 36px)' },
                top: { xs: 'calc(42% + 36px)', sm: 'calc(42% - 48px)' },
                width: 300,
                maxWidth: 'calc(100% - 32px)',
                zIndex: 3,
                boxShadow: 8,
                borderRadius: 1,
              }}
            >
              {cardHost && (
                <InuksukInfoCard
                  item={item}
                  container={cardHost}
                  onClose={() => setCard(false)}
                  onEdit={prototypeAction}
                />
              )}
            </Box>
          )}
        </Box>
        <Drawer
          variant="permanent"
          anchor="right"
          data-testid="inspector-shell"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false)
          }}
          sx={{
            gridColumn: 2,
            gridRow: '1 / -1',
            width: { xs: miniWidth.xs, sm: open && pinned ? 300 : miniWidth.sm },
            flexShrink: 0,
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration:
                open && pinned
                  ? theme.transitions.duration.enteringScreen
                  : theme.transitions.duration.leavingScreen,
            }),
          }}
          slotProps={{
            paper: {
              ref: drawerRef,
              role: 'complementary',
              'aria-label': 'Image inspector',
              sx: {
                position: 'absolute',
                top: 0,
                right: 0,
                height: '100%',
                width: { xs: open ? '100%' : miniWidth.xs, sm: open ? 300 : miniWidth.sm },
                boxSizing: 'border-box',
                overflow: 'hidden',
                transition: drawerTransition,
                borderLeftWidth: { xs: 0, sm: 1 },
                borderLeftStyle: 'solid',
                borderColor: 'divider',
                bgcolor: { xs: 'transparent', sm: 'background.paper' },
                pointerEvents: { xs: 'none', sm: 'auto' },
                display: { xs: 'grid', sm: 'flex' },
                flexDirection: 'column',
                gridTemplateColumns: open ? `minmax(0, 1fr) ${miniWidth.xs}` : miniWidth.xs,
                gridTemplateRows: open ? 'minmax(0, 2fr) minmax(0, 3fr)' : '1fr',
                zIndex: 4,
              },
            },
          }}
        >
          <Box
            data-testid="inspector-rail"
            component="nav"
            aria-label="Inspector destinations"
            sx={{
              gridColumn: open ? 2 : 1,
              gridRow: '1 / -1',
              minWidth: 0,
              flexShrink: 0,
              bgcolor: 'background.paper',
              borderLeftWidth: { xs: 1, sm: 0 },
              borderLeftStyle: 'solid',
              borderColor: 'divider',
              pointerEvents: 'auto',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'row-reverse',
                alignItems: 'center',
                height: 56,
              }}
            >
              <Box
                sx={{
                  width: { xs: theme.spacing(7), sm: theme.spacing(8) },
                  flexShrink: 0,
                  textAlign: 'center',
                }}
              >
                <Tooltip title={open ? 'Collapse inspector' : 'Expand inspector'} placement="left">
                  <IconButton
                    aria-label={open ? 'Collapse inspector' : 'Expand inspector'}
                    aria-expanded={open}
                    aria-controls="prototype-inspector-panel"
                    onClick={() => setOpen(!open)}
                  >
                    {open ? <ChevronRight /> : <Menu />}
                  </IconButton>
                </Tooltip>
              </Box>
              {open && (
                <Typography
                  component="span"
                  variant="subtitle1"
                  sx={{ display: { xs: 'none', sm: 'block' }, flex: 1, pl: 2 }}
                >
                  Inspector
                </Typography>
              )}
            </Box>
            <Divider />
            <List disablePadding sx={{ py: 1 }}>
              {(['Details', 'Inuksuks'] as const).map((name) => (
                <ListItem key={name} disablePadding sx={{ display: 'block' }}>
                  <Tooltip
                    title={open ? '' : name}
                    placement="left"
                    slotProps={{ tooltip: { 'aria-label': name } }}
                  >
                    <ListItemButton
                      component="button"
                      ref={name === 'Details' ? detailsTriggerRef : inuksuksTriggerRef}
                      aria-label={
                        name === 'Details' ? 'Image details' : `Inuksuks (${items.length})`
                      }
                      aria-expanded={open && tab === name}
                      aria-controls="prototype-inspector-panel"
                      aria-current={tab === name ? 'true' : undefined}
                      selected={tab === name}
                      onClick={() => toggle(name)}
                      sx={{
                        flexDirection: 'row-reverse',
                        minHeight: 48,
                        px: 0,
                        width: {
                          xs: `calc(100% - ${theme.spacing(1)})`,
                          sm: `calc(100% - ${theme.spacing(2)})`,
                        },
                        textAlign: 'left',
                        mx: { xs: 0.5, sm: 1 },
                        my: 0.5,
                        borderRadius: 6,
                        color: 'text.primary',
                        '&.Mui-selected': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
                        '&.Mui-selected:hover': {
                          bgcolor: alpha(theme.palette.primary.main, 0.24),
                        },
                        '&:active': { bgcolor: alpha(theme.palette.primary.main, 0.32) },
                        '&.Mui-focusVisible': {
                          outline: '2px solid',
                          outlineColor: 'primary.main',
                          outlineOffset: -2,
                        },
                      }}
                    >
                      <ListItemIcon
                        sx={{ minWidth: 48, justifyContent: 'center', color: 'inherit' }}
                      >
                        {name === 'Details' ? <InfoOutlined /> : <CompassCalibration />}
                      </ListItemIcon>
                      <ListItemText
                        primary={name}
                        aria-hidden={!open}
                        sx={{
                          display: { xs: 'none', sm: 'block' },
                          minWidth: 0,
                          pl: open ? 2 : 0,
                          opacity: open ? 1 : 0,
                          whiteSpace: 'nowrap',
                        }}
                      />
                    </ListItemButton>
                  </Tooltip>
                </ListItem>
              ))}
            </List>
          </Box>
          {open && (
            <Box
              component="section"
              aria-label={`${tab} inspector`}
              id="prototype-inspector-panel"
              data-testid="inspector-panel"
              sx={{
                gridColumn: 1,
                gridRow: 2,
                alignSelf: { xs: 'stretch', sm: 'flex-end' },
                width: { xs: 'auto', sm: 299 },
                minWidth: 0,
                minHeight: 0,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.paper',
                borderTop: 1,
                borderColor: 'divider',
                pointerEvents: 'auto',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <Typography component="h2" variant="subtitle1" sx={{ flex: 1 }}>
                  {tab}
                </Typography>
                <Tooltip title={pinned ? 'Overlay image' : 'Make room for panel'}>
                  <IconButton
                    aria-label={pinned ? 'Unpin inspector' : 'Pin inspector'}
                    aria-pressed={pinned}
                    onClick={() => setPinned(!pinned)}
                    sx={{ bgcolor: pinned ? 'action.selected' : undefined }}
                  >
                    {pinned ? <PushPin /> : <PushPinOutlined />}
                  </IconButton>
                </Tooltip>
              </Box>
              {tab === 'Details' ? (
                <Box sx={embeddedDrawerSx}>
                  <ImageDetailsDrawer
                    image={{
                      copyright: 'Educational specimen',
                      width: 4820,
                      height: 3210,
                      fileSize: 4718592,
                      createdAt: '2026-01-02T03:04:05Z',
                    }}
                    programNames={['Biomedical Science']}
                    groupNames={['Histology lab']}
                    measurement={{ scale: 12, unit: 'µm' }}
                    sourceInfo={{
                      originalFilename: 'renal-specimen.tif',
                      fileType: 'TIF',
                      uploadedByName: 'Alex',
                    }}
                    open
                    onOpenChange={setOpen}
                    triggerRef={detailsTriggerRef}
                    drawerLabel="Prototype specimen"
                    drawerId="prototype-details"
                  />
                </Box>
              ) : (
                <Stack sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {draft && (
                    <Box
                      ref={setFormHost}
                      data-testid="inline-placement"
                      sx={{ ...embeddedCardSx, borderBottom: 1, borderColor: 'divider' }}
                    />
                  )}
                  <Box sx={{ ...embeddedDrawerSx, minHeight: 220 }}>
                    <ImageInuksuksDrawer
                      items={items}
                      open
                      pinned
                      onPinnedChange={() => {}}
                      onOpenChange={setOpen}
                      triggerRef={inuksuksTriggerRef}
                      drawerId="prototype-inuksuks"
                      prefs={prefs}
                      onSelect={() => setCard(true)}
                      onEdit={prototypeAction}
                      onDelete={prototypeAction}
                    />
                  </Box>
                </Stack>
              )}
            </Box>
          )}
        </Drawer>
        {draft && !(open && tab === 'Inuksuks') && (
          <Box
            ref={setFormHost}
            data-testid="floating-placement"
            sx={{
              ...embeddedCardSx,
              position: 'absolute',
              top: 8,
              right: {
                xs: `calc(${miniWidth.xs} + ${theme.spacing(1)})`,
                sm: `calc(${open ? '300px' : miniWidth.sm} + ${theme.spacing(1)})`,
              },
              width: { xs: `calc(100% - ${miniWidth.xs} - ${theme.spacing(2)})`, sm: 288 },
              maxHeight: 'calc(100% - 24px)',
              overflowY: 'auto',
              zIndex: 3,
              boxShadow: 8,
            }}
          />
        )}
        {draft && formHost && (
          <ThemeProvider theme={formTheme}>
            <InuksukFormDialog
              placement
              imageId={42}
              view={item}
              container={formHost}
              services={services}
              onClose={() => setDraft(false)}
              onChanged={() => {
                setDraft(false)
                prototypeAction()
              }}
            />
          </ThemeProvider>
        )}
      </Box>
      {message ? (
        <Alert severity="info" onClose={() => setMessage('')}>
          {message}
        </Alert>
      ) : (
        <Typography variant="caption" color="text.secondary">
          Mock image · no pan/zoom · one panel, one shared pin · no app data is changed
        </Typography>
      )}
    </Stack>
  )
}
