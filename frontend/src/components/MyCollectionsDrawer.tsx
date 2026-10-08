import { useEffect, useMemo, useRef } from 'react'
import AddIcon from '@mui/icons-material/Add'
import CollectionsIcon from '@mui/icons-material/Collections'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
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
  const paperRef = useRef<HTMLDivElement | null>(null)
  const drawerOpen = open && collections.length > 0

  useEffect(() => {
    if (!onPinnedHeightChange) return
    if (!pinned || !drawerOpen) {
      onPinnedHeightChange(0)
      return
    }

    const paper = paperRef.current
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

  return (
    <>
      {!drawerOpen && collections.length > 0 && (
        <Button
          variant="contained"
          startIcon={<CollectionsIcon />}
          onClick={() => onOpenChange(true)}
          sx={{
            position: 'fixed',
            left: 16,
            bottom: bottomOffset + 16,
            zIndex: (theme) => theme.zIndex.speedDial,
            boxShadow: 6,
          }}
        >
          My collections
        </Button>
      )}

      <Drawer
        anchor="bottom"
        variant={pinned ? 'persistent' : 'temporary'}
        open={drawerOpen}
        onClose={() => onOpenChange(false)}
        sx={!pinned ? { bottom: bottomOffset } : undefined}
        slotProps={{
          paper: {
            ref: paperRef,
            'aria-labelledby': DRAWER_TITLE_ID,
            sx: {
              width: '100%',
              maxHeight: '50vh',
              bottom: bottomOffset,
              overflowX: 'hidden',
              overflowY: 'auto',
            },
          },
          ...(!pinned ? { backdrop: { sx: { bottom: bottomOffset } } } : {}),
        }}
      >
        <Box
          component="section"
          aria-labelledby={DRAWER_TITLE_ID}
          sx={{ display: 'flex', flexShrink: 0, flexDirection: 'column' }}
        >
          <Box
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              bgcolor: 'background.paper',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
              px: 2,
              py: 1.5,
            }}
          >
            <IconButton
              aria-label="Collapse My collections"
              onClick={() => onOpenChange(false)}
              size="small"
            >
              <ExpandMoreIcon />
            </IconButton>
            <Typography id={DRAWER_TITLE_ID} component="h2" variant="h6">
              My collections
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
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
              pb: 2,
            }}
          >
            {collections.slice(0, 8).map((collection) => {
              const segment =
                collection.categoryId != null ? categoryPaths.get(collection.categoryId) : undefined
              const categoryPath = segment ? [...segment.ancestors, segment.category] : []
              return (
                <Box key={collection.id} sx={{ flex: '1 0 160px', minWidth: 160, maxWidth: 180 }}>
                  <CollectionCard
                    collection={collection}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onPickCoverImage={onPickCoverImage}
                    density="compact"
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
      </Drawer>
    </>
  )
}
