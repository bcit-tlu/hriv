import { useEffect, useMemo, useRef } from 'react'
import AddIcon from '@mui/icons-material/Add'
import CollectionsIcon from '@mui/icons-material/Collections'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Fade from '@mui/material/Fade'
import IconButton from '@mui/material/IconButton'
import Slide from '@mui/material/Slide'
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
  onPinnedHeightChange?: (px: number) => void
  bottomOffset: number
}

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
  onPinnedHeightChange,
  bottomOffset,
}: MyCollectionsDrawerProps) {
  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])
  // Slide merges its own measurement ref into the child's `ref`, so a
  // plain ref here reads the sheet's DOM node for height reporting.
  const ownRef = useRef<HTMLDivElement | null>(null)
  const drawerOpen = open && collections.length > 0

  useEffect(() => {
    if (!onPinnedHeightChange) return
    if (!pinned || !drawerOpen) {
      onPinnedHeightChange(0)
      return
    }

    const paper = ownRef.current
    if (!paper) {
      onPinnedHeightChange(0)
      return
    }

    const reportHeight = () => onPinnedHeightChange(paper.getBoundingClientRect().height)
    reportHeight()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(reportHeight)
    observer.observe(paper)
    return () => {
      observer.disconnect()
      onPinnedHeightChange(0)
    }
  }, [drawerOpen, onPinnedHeightChange, pinned])

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

  return (
    // The temporary sheet is aria-modal, so it keeps the Modal-parity focus
    // trap the old MUI Drawer had — the trigger button sits inside the trap
    // as the first tabbable (it is the sheet's title), and focus returns to
    // it on close. Pinned mode never traps: the sheet is page furniture.
    // `isEnabled` defers to any open MUI modal — dialogs and menus launched
    // from the sheet portal outside this subtree, and the modal's own trap
    // must win or their inputs would be unfocusable.
    <TrapFocus
      open={!pinned && drawerOpen}
      isEnabled={() => !document.querySelector('.MuiModal-root')}
    >
      <Box>
        {collections.length > 0 && (
          <Button
            id={DRAWER_TITLE_ID}
            variant="contained"
            startIcon={<CollectionsIcon />}
            onClick={() => onOpenChange(!drawerOpen)}
            aria-expanded={drawerOpen}
            sx={{
              position: 'fixed',
              left: 16,
              bottom: bottomOffset + 16,
              // The sheet slides up BENEATH this button: it stays mounted at
              // its bottom-left anchor in both states (no re-render, no
              // position jump) and doubles as the drawer's title — the sheet
              // names itself after it via aria-labelledby.
              zIndex: (theme) => theme.zIndex.drawer + 1,
              boxShadow: 6,
            }}
          >
            My collections
          </Button>
        )}

        {/* Temporary-mode backdrop — under the sheet (and under the trigger
          button) but never over the footer: its bottom edge rides the same
          live footer gap the sheet does, so the footer stays clickable. */}
        {!pinned && collections.length > 0 && (
          <Fade in={drawerOpen}>
            <Box
              aria-hidden
              data-testid="my-collections-backdrop"
              onClick={() => onOpenChange(false)}
              sx={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: bottomOffset,
                // An invisible overlay must never eat clicks, even mid-fade.
                pointerEvents: drawerOpen ? 'auto' : 'none',
                bgcolor: (theme) => alpha(theme.palette.common.black, 0.5),
                zIndex: (theme) => theme.zIndex.drawer - 1,
              }}
            />
          </Fade>
        )}

        {/* One sheet for BOTH modes — Slide keeps the subtree mounted whether
          the drawer is open or closed, so toggling the pin only swaps the
          backdrop/page-padding behaviour; tiles and thumbnails never
          remount (the transition is imperceptible). The bottom edge rides
          the live footer gap: when the footer scrolls into view the sheet
          attaches to its top edge and moves with it. */}
        {collections.length > 0 && (
          <Slide direction="up" in={drawerOpen} appear={false}>
            <Box
              component="section"
              role={pinned ? 'region' : 'dialog'}
              aria-modal={pinned ? undefined : true}
              aria-labelledby={DRAWER_TITLE_ID}
              ref={ownRef}
              sx={{
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: bottomOffset,
                maxHeight: '50vh',
                zIndex: (theme) => theme.zIndex.drawer,
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.paper',
                boxShadow: 8,
                overflowY: 'auto',
              }}
            >
              <Box
                sx={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  bgcolor: 'background.paper',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 1,
                  flexWrap: 'wrap',
                  px: 2,
                  py: 1.5,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    gap: 1,
                    order: { xs: 3, sm: 0 },
                    width: { xs: '100%', sm: 'auto' },
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
                </Box>
                <IconButton
                  aria-label={pinned ? 'Unpin My collections' : 'Pin My collections'}
                  aria-pressed={pinned}
                  // Unpinning must not collapse the sheet — it only hands the
                  // drawer back to temporary mode (backdrop + page padding).
                  onClick={() => onPinnedChange(!pinned)}
                >
                  {pinned ? <PushPinIcon /> : <PushPinOutlinedIcon />}
                </IconButton>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  flexShrink: 0,
                  gap: 2,
                  justifyContent: 'flex-start',
                  overflowX: 'auto',
                  px: 2,
                  // The trigger button floats over the sheet's bottom-left
                  // corner — pad the strip so it never covers a tile.
                  pb: 8,
                }}
              >
                {collections.slice(0, 8).map((collection) => {
                  const segment =
                    collection.categoryId != null
                      ? categoryPaths.get(collection.categoryId)
                      : undefined
                  const categoryPath = segment ? [...segment.ancestors, segment.category] : []
                  return (
                    <Box
                      key={collection.id}
                      sx={{ flex: '1 0 160px', minWidth: 160, maxWidth: 180 }}
                    >
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
          </Slide>
        )}
      </Box>
    </TrapFocus>
  )
}
