import { useEffect, useMemo, useRef, useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import CollectionsIcon from '@mui/icons-material/Collections'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Fade from '@mui/material/Fade'
import IconButton from '@mui/material/IconButton'
import { alpha } from '@mui/material/styles'
import Tooltip from '@mui/material/Tooltip'
import TrapFocus from '@mui/material/Unstable_TrapFocus'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { COLLECTIONS_AT_CAP_TOOLTIP } from '../collectionUtils'
import { getCategoryHiddenStateFromPath } from '../treeUtils'
import type { Category, CollectionSummary, Group, Program } from '../types'
import { buildCategoryPaths } from './CategoryBreadcrumb'
import CollectionCard from './CollectionCard'

const DRAWER_TITLE_ID = 'my-collections-drawer-title'

/** Gap between the resting trigger button and the footer's top edge, and
 *  the header's horizontal padding — both 16px so the attached button lands
 *  exactly on its in-flow placeholder. */
const TRIGGER_INSET_PX = 16
/** The sheet header's vertical padding (`py: 1.5`). */
const HEADER_PAD_Y_PX = 12
/** Title slot (placeholder button) geometry inside the sheet, replaced by
 *  the live measurement once mounted: MUI medium Button height, offset by
 *  the header padding. */
const DEFAULT_TITLE_SLOT = { top: HEADER_PAD_Y_PX, height: 36.5 }

export interface MyCollectionsDrawerProps {
  collections: CollectionSummary[]
  categories: Category[]
  programs: Program[]
  groups?: Group[]
  open: boolean
  pinned: boolean
  onOpenChange: (open: boolean) => void
  onPinnedChange: (pinned: boolean) => void
  onOpen: (collection: CollectionSummary) => void
  onEdit?: (collection: CollectionSummary) => void
  onPickCoverImage?: (collection: CollectionSummary) => void
  onSeeAll: () => void
  onNewCollection: () => void
  newCollectionDisabled?: boolean
}

/**
 * The My collections sheet. Rendered inside the AppShell footer dock, directly
 * above `FooterBar`, so it is ordinary in-flow content: the dock (sheet +
 * footer) is what sticks to the viewport bottom, and rubber-band overscroll
 * moves both together. Opening animates the sheet's height from 0 to its
 * measured natural height — the sheet's top edge rises out of the footer's top
 * border and the cards are revealed from behind the footer, which paints above
 * the sheet.
 */
export default function MyCollectionsDrawer({
  collections,
  categories,
  programs,
  groups,
  open,
  pinned,
  onOpenChange,
  onPinnedChange,
  onOpen,
  onEdit,
  onPickCoverImage,
  onSeeAll,
  onNewCollection,
  newCollectionDisabled = false,
}: MyCollectionsDrawerProps) {
  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])
  const contentRef = useRef<HTMLDivElement | null>(null)
  const titleSlotRef = useRef<HTMLButtonElement | null>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const [titleSlot, setTitleSlot] = useState(DEFAULT_TITLE_SLOT)
  const drawerOpen = open && collections.length > 0

  // The sheet's natural height drives the open/close height animation (the
  // content keeps its layout while hidden, so it is measurable when closed),
  // and the title slot's position inside it (centred against the taller pin
  // IconButton; the header can wrap) is where the floating trigger lands.
  useEffect(() => {
    const content = contentRef.current
    const slot = titleSlotRef.current
    if (!content || !slot || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const contentRect = content.getBoundingClientRect()
      const slotRect = slot.getBoundingClientRect()
      if (contentRect.height > 0) setContentHeight(contentRect.height)
      if (slotRect.height > 0) {
        const top = slotRect.top - contentRect.top
        setTitleSlot((current) =>
          current.top === top && current.height === slotRect.height
            ? current
            : { top, height: slotRect.height },
        )
      }
    })
    observer.observe(content)
    observer.observe(slot)
    return () => observer.disconnect()
  }, [collections.length])

  // Escape closes only the temporary (unpinned) sheet — a pinned sheet is
  // page furniture and never collapses from the keyboard.
  useEffect(() => {
    if (!drawerOpen || pinned) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen, pinned, onOpenChange])

  if (collections.length === 0) return null

  return (
    // The temporary sheet is aria-modal, so it keeps the Modal-parity focus
    // trap the old MUI Drawer had — the trigger button sits inside the trap
    // as the first tabbable (it is the sheet's title), and focus returns to
    // it on close. Pinned mode never traps: the sheet is page furniture.
    // `isEnabled` defers to any actively-open MUI modal — dialogs and menus
    // launched from the sheet portal outside this subtree, and the modal's
    // own trap must win or their inputs would be unfocusable. The marker is
    // the modal's own FocusTrap sentinel: its tabIndex flips to -1 the
    // moment the modal's `open` goes false, so a root lingering through the
    // exit transition does not keep this trap suppressed.
    <TrapFocus
      open={!pinned && drawerOpen}
      isEnabled={() =>
        !document.querySelector('.MuiModal-root [data-testid="sentinelStart"][tabindex="0"]')
      }
    >
      <Box
        sx={{
          position: 'relative',
          // Animating the height (not a transform) keeps the sheet in flow:
          // nothing ever extends below the footer, the page grows by the
          // sheet's height so pinned content stays reachable, and the dock
          // stays a single sticky block. (A `0fr`/`1fr` grid track is not
          // used because Chrome sizes the container larger than the track
          // mid-interpolation, which opened a gap above the footer.)
          height: drawerOpen ? (contentHeight ?? 'auto') : 0,
          transition: (theme) =>
            theme.transitions.create('height', {
              duration: theme.transitions.duration.standard,
            }),
        }}
      >
        {/* Temporary-mode backdrop. It is a fixed overlay but stacks inside
          the footer dock, so it dims the page while the sheet (zIndex 1) and
          the footer (zIndex 2) stay above it. */}
        {!pinned && (
          <Fade in={drawerOpen}>
            <Box
              aria-hidden
              data-testid="my-collections-backdrop"
              onClick={() => onOpenChange(false)}
              sx={{
                position: 'fixed',
                inset: 0,
                // An invisible overlay must never eat clicks, even mid-fade.
                pointerEvents: drawerOpen ? 'auto' : 'none',
                bgcolor: (theme) => alpha(theme.palette.common.black, 0.5),
                zIndex: 0,
              }}
            />
          </Fade>
        )}

        {/* One sheet for BOTH modes — it stays mounted whether the drawer is
          open or closed, so toggling the pin only swaps the backdrop and the
          trigger's appearance; tiles and thumbnails never remount. */}
        <Box
          component="section"
          role={pinned ? 'region' : 'dialog'}
          aria-modal={pinned ? undefined : true}
          aria-labelledby={DRAWER_TITLE_ID}
          inert={!drawerOpen}
          sx={{
            position: 'relative',
            zIndex: 1,
            height: '100%',
            overflow: 'hidden',
            bgcolor: 'background.paper',
            // Elevation shows along the rising top edge only — the footer
            // paints over the sheet's bottom shadow, so the two read as one
            // surface.
            boxShadow: 8,
            visibility: drawerOpen ? 'visible' : 'hidden',
            transition: (theme) =>
              theme.transitions.create('visibility', {
                duration: theme.transitions.duration.standard,
              }),
          }}
        >
          <Box ref={contentRef}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                flexWrap: 'wrap',
                px: `${TRIGGER_INSET_PX}px`,
                py: `${HEADER_PAD_Y_PX}px`,
              }}
            >
              {/* In-flow placeholder for the trigger: reserves the title slot
              the floating button lands on once the sheet is open. */}
              <Button
                ref={titleSlotRef}
                aria-hidden
                tabIndex={-1}
                variant="contained"
                startIcon={<CollectionsIcon />}
                sx={{ visibility: 'hidden', pointerEvents: 'none' }}
              >
                My collections
              </Button>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  ml: 'auto',
                }}
              >
                <Tooltip title={newCollectionDisabled ? COLLECTIONS_AT_CAP_TOOLTIP : ''}>
                  <span>
                    <Button
                      startIcon={<AddIcon />}
                      onClick={onNewCollection}
                      disabled={newCollectionDisabled}
                    >
                      New collection
                    </Button>
                  </span>
                </Tooltip>
                <Button onClick={onSeeAll}>See all</Button>
                <IconButton
                  aria-label={pinned ? 'Unpin My collections' : 'Pin My collections'}
                  aria-pressed={pinned}
                  // Unpinning must not collapse the sheet — it only hands the
                  // drawer back to temporary mode (backdrop + clickable trigger).
                  onClick={() => onPinnedChange(!pinned)}
                >
                  {pinned ? <PushPinIcon /> : <PushPinOutlinedIcon />}
                </IconButton>
              </Box>
            </Box>

            <Box
              sx={{
                display: 'flex',
                gap: 2,
                justifyContent: 'flex-start',
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: '50vh',
                px: `${TRIGGER_INSET_PX}px`,
                pb: 2,
              }}
            >
              {collections.slice(0, 8).map((collection) => {
                const segment =
                  collection.categoryId != null
                    ? categoryPaths.get(collection.categoryId)
                    : undefined
                const categoryPath = segment ? [...segment.ancestors, segment.category] : []
                return (
                  <Box key={collection.id} sx={{ flex: '1 0 160px', minWidth: 160, maxWidth: 180 }}>
                    <CollectionCard
                      collection={collection}
                      onOpen={onOpen}
                      onEdit={onEdit}
                      onPickCoverImage={onPickCoverImage}
                      density="minimal"
                      titleHeadingLevel="h3"
                      programs={programs}
                      inheritedProgramIds={narrowProgramIds(categoryPath)}
                      groups={groups}
                      inheritedGroupIds={narrowGroupIds(categoryPath)}
                      categoryHidden={getCategoryHiddenStateFromPath(categoryPath).hidden}
                    />
                  </Box>
                )
              })}
            </Box>
          </Box>
        </Box>

        {/* The trigger doubles as the sheet's title (aria-labelledby). It is
          positioned against the animated sheet height: at rest it sits
          TRIGGER_INSET_PX above the footer; as the sheet grows past the
          title slot the `max()` flips and the button rides up with the
          header, detaching again at the same point on the way down. While
          pinned it reads as an outlined, non-interactive title. */}
        <Button
          id={DRAWER_TITLE_ID}
          variant={pinned ? 'outlined' : 'contained'}
          startIcon={<CollectionsIcon />}
          onClick={pinned ? undefined : () => onOpenChange(!drawerOpen)}
          aria-expanded={drawerOpen}
          aria-disabled={pinned || undefined}
          tabIndex={pinned ? -1 : undefined}
          sx={{
            position: 'absolute',
            left: TRIGGER_INSET_PX,
            bottom: `max(${TRIGGER_INSET_PX}px, calc(100% - ${titleSlot.top + titleSlot.height}px))`,
            zIndex: 3,
            boxShadow: pinned ? 'none' : 6,
            pointerEvents: pinned ? 'none' : undefined,
            bgcolor: pinned ? 'background.paper' : undefined,
          }}
        >
          My collections
        </Button>
      </Box>
    </TrapFocus>
  )
}
