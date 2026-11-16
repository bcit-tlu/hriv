import { useEffect, useMemo, useRef, useState } from 'react'
import { alpha, createTheme, ThemeProvider, useTheme } from '@mui/material/styles'
import {
  Alert,
  Box,
  ButtonBase,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Close,
  CompassCalibration,
  InfoOutlined,
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
  const panelRef = useRef<HTMLElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
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
        panelRef.current?.contains(target) ||
        railRef.current?.contains(target) ||
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
          gridTemplateColumns: { xs: 'minmax(0, 1fr) auto 48px', sm: 'minmax(0, 1fr) auto 76px' },
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
        {open && (
          <Paper
            component="aside"
            aria-label={`${tab} inspector`}
            id="prototype-inspector-panel"
            ref={panelRef}
            data-testid="inspector-panel"
            square
            elevation={0}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
            }}
            sx={{
              position: pinned ? 'relative' : 'absolute',
              right: pinned ? 'auto' : { xs: 48, sm: 76 },
              top: pinned ? 'auto' : { xs: 'auto', sm: 0 },
              bottom: pinned ? 'auto' : 0,
              left: { xs: pinned ? 'auto' : 0, sm: 'auto' },
              width: { xs: 'auto', sm: 288 },
              minWidth: 0,
              height: { xs: pinned ? 'auto' : '60%', sm: '100%' },
              gridColumn: pinned ? { xs: '1 / 3', sm: 2 } : undefined,
              gridRow: pinned ? { xs: 2, sm: 1 } : undefined,
              borderLeft: { xs: 0, sm: 1 },
              borderTop: { xs: 1, sm: 0 },
              borderColor: 'divider',
              bgcolor: 'background.paper',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              zIndex: 4,
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
              <IconButton aria-label="Close inspector" onClick={() => setOpen(false)}>
                <Close />
              </IconButton>
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
          </Paper>
        )}
        <Box
          ref={railRef}
          data-testid="inspector-rail"
          role="toolbar"
          aria-label="Inspector rail"
          aria-orientation="vertical"
          sx={{
            gridColumn: 3,
            gridRow: '1 / -1',
            width: { xs: 48, sm: 76 },
            boxSizing: 'border-box',
            borderLeft: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            zIndex: 5,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            py: 1.5,
          }}
        >
          {(['Details', 'Inuksuks'] as const).map((name) => {
            const active = open && tab === name
            return (
              <ButtonBase
                key={name}
                ref={name === 'Details' ? detailsTriggerRef : inuksuksTriggerRef}
                aria-label={name === 'Details' ? 'Image details' : `Inuksuks (${items.length})`}
                aria-expanded={active}
                aria-controls="prototype-inspector-panel"
                onClick={() => toggle(name)}
                sx={{
                  width: '100%',
                  minHeight: { xs: 48, sm: 64 },
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  color: 'text.primary',
                  '&:hover .rail-indicator': {
                    bgcolor: (theme) => alpha(theme.palette.primary.main, active ? 0.24 : 0.08),
                  },
                  '&:active .rail-indicator': {
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.32),
                  },
                  '&.Mui-focusVisible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: -2,
                  },
                }}
              >
                <Box
                  className="rail-indicator"
                  sx={{
                    display: 'grid',
                    placeItems: 'center',
                    width: { xs: 40, sm: 56 },
                    height: 32,
                    borderRadius: 4,
                    bgcolor: (theme) =>
                      active ? alpha(theme.palette.primary.main, 0.16) : 'transparent',
                  }}
                >
                  {name === 'Details' ? <InfoOutlined /> : <CompassCalibration />}
                </Box>
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ display: { xs: 'none', sm: 'block' }, fontWeight: active ? 700 : 500 }}
                >
                  {name}
                </Typography>
              </ButtonBase>
            )
          })}
        </Box>
        {draft && !(open && tab === 'Inuksuks') && (
          <Box
            ref={setFormHost}
            data-testid="floating-placement"
            sx={{
              ...embeddedCardSx,
              position: 'absolute',
              top: 8,
              right: { xs: 56, sm: 84 },
              width: { xs: 'calc(100% - 64px)', sm: 288 },
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
