import { useEffect, useRef, useState } from 'react'
import { Alert, Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { Close, PushPin, PushPinOutlined } from '@mui/icons-material'
import ImageDetailsDrawer, { ImageDetailsTrigger } from '../../components/ImageDetailsDrawer'
import ImageInuksuksDrawer, { ImageInuksuksTrigger } from '../../components/ImageInuksuksDrawer'
import InuksukFormDialog from '../../components/InuksukFormDialog'
import InuksukInfoCard from '../../components/InuksukInfoCard'
import { PROTOTYPE_BOARD, PROTOTYPE_ITEM as item } from './fixtures'
import { usePinnedDrawerState } from '../../usePinnedDrawerState'
import type { InuksukVisibilityPrefs } from '../../useInuksukVisibilityPrefs'

const items = [
  item,
  { ...item, id: 8, title: 'Surrounding tubules', favourite: false },
  { ...item, id: 9, title: 'Instructor reference', source: 'instructor' as const },
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
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          bgcolor: 'background.default',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <Box
          data-testid="image-viewport"
          sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}
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
            elevation={pinned ? 0 : 8}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
            }}
            sx={{
              position: pinned ? 'relative' : 'absolute',
              right: pinned ? 'auto' : { xs: 0, sm: 64 },
              top: pinned ? 'auto' : { xs: 'auto', sm: 8 },
              bottom: pinned ? 'auto' : { xs: 0, sm: 8 },
              left: { xs: pinned ? 'auto' : 0, sm: 'auto' },
              width: { xs: '100%', sm: 360 },
              maxWidth: { xs: '100%', sm: 'calc(100% - 80px)' },
              height: { xs: '60%', sm: pinned ? '100%' : 'auto' },
              mr: { xs: 0, sm: pinned ? '64px' : 0 },
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
          role="toolbar"
          aria-label="Inspector rail"
          aria-orientation="vertical"
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 5,
            display: 'flex',
            flexDirection: 'column',
            '& button[aria-expanded="true"]': {
              boxShadow: (theme) => `inset 0 0 0 3px ${theme.palette.primary.main}`,
            },
          }}
        >
          <ImageDetailsTrigger
            open={open && tab === 'Details'}
            onOpenChange={() => toggle('Details')}
            triggerRef={detailsTriggerRef}
            drawerId="prototype-inspector-panel"
          />
          <ImageInuksuksTrigger
            open={open && tab === 'Inuksuks'}
            count={items.length}
            onOpenChange={() => toggle('Inuksuks')}
            triggerRef={inuksuksTriggerRef}
            drawerId="prototype-inspector-panel"
          />
        </Box>
        {draft && !(open && tab === 'Inuksuks') && (
          <Box
            ref={setFormHost}
            data-testid="floating-placement"
            sx={{
              ...embeddedCardSx,
              position: 'absolute',
              top: 8,
              right: 64,
              width: { xs: 'calc(100% - 80px)', sm: 340 },
              maxHeight: 'calc(100% - 24px)',
              overflowY: 'auto',
              zIndex: 3,
              boxShadow: 8,
            }}
          />
        )}
        {draft && formHost && (
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
