import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CollectionsIcon from '@mui/icons-material/Collections'
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove'
import EditIcon from '@mui/icons-material/Edit'
import LockIcon from '@mui/icons-material/Lock'
import PublicIcon from '@mui/icons-material/Public'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import ViewCarouselIcon from '@mui/icons-material/ViewCarousel'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import { fetchCollection } from '../api'
import { getInheritedRestrictionSx } from '../restrictionStyles'
import type { CollectionSummary, CollectionVisibility, Group, Program } from '../types'
import {
  COLLECTION_TYPE_LABELS,
  COLLECTION_VISIBILITY_LABELS,
  describeCollectionOwners,
} from '../collectionUtils'
import { getGroupChipColors, getVisibilityColors } from '../theme'
import { useColorMode } from '../useColorMode'
import RenewingThumbnail from './RenewingThumbnail'

export interface CollectionCardProps {
  collection: CollectionSummary
  onOpen: (collection: CollectionSummary) => void
  /** Rendered only when `collection.permissions.canEdit` (UX gate — the API re-checks). */
  onEdit?: (collection: CollectionSummary) => void
  /** Owners & transfer dialog (#1531) — gated on `permissions.canTransfer`. */
  onTransfer?: (collection: CollectionSummary) => void
  /**
   * Move/file into a category (#1529). Unlike the other actions this is
   * role-gated by the caller (any admin/instructor may file — it is
   * curatorial, not ownership-bound), so it renders whenever provided.
   */
  onMove?: (collection: CollectionSummary) => void
  /** Restriction chip lookup (#1567) — same contract as CategoryTile. */
  programs: Program[]
  /** Effective program restriction inherited from the filed category. */
  inheritedProgramIds?: number[]
  groups?: Group[]
  /** Effective group restriction inherited from the filed category. */
  inheritedGroupIds?: number[]
}

/**
 * Visibility chip styling mirrors the category restriction chips: `restricted`
 * borrows the group-chip colours (the restricted dimension users already know),
 * `public` is neutral-outlined, `private` uses the muted visibility grey.
 */
export function CollectionVisibilityChip({ visibility }: { visibility: CollectionVisibility }) {
  const { mode } = useColorMode()
  const groupColors = getGroupChipColors(mode)
  const visColors = getVisibilityColors(mode)
  const label = COLLECTION_VISIBILITY_LABELS[visibility]
  if (visibility === 'restricted') {
    return (
      <Chip
        data-testid="collection-visibility-chip"
        label={label}
        size="small"
        sx={{ bgcolor: groupColors.solidBg, color: groupColors.solidText }}
      />
    )
  }
  // Chip icons sit at the 14px lock convention used beside category titles
  // — `.MuiChip-icon` (18px for small chips) otherwise overrides the icon's
  // own sx font-size, so the size must live on the chip (#1567).
  if (visibility === 'public') {
    return (
      <Chip
        data-testid="collection-visibility-chip"
        label={label}
        size="small"
        variant="outlined"
        icon={<PublicIcon />}
        sx={{ '& .MuiChip-icon': { fontSize: 14 } }}
      />
    )
  }
  return (
    <Chip
      data-testid="collection-visibility-chip"
      label={label}
      size="small"
      icon={<LockIcon />}
      sx={{
        bgcolor: visColors.inactiveChipBg,
        color: '#fff',
        '& .MuiChip-icon': { color: '#fff', fontSize: 14 },
      }}
    />
  )
}

/** Cover thumbs are keyed by collection id, so an expired token is renewed via the collection record. */
function renewCoverThumb(id: number): Promise<{ id: number; thumb: string | null }> {
  return fetchCollection(id).then((c) => ({ id: c.id, thumb: c.cover_thumb }))
}

export default function CollectionCard({
  collection,
  onOpen,
  onEdit,
  onTransfer,
  onMove,
  programs,
  inheritedProgramIds = [],
  groups = [],
  inheritedGroupIds = [],
}: CollectionCardProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  const cover = collection.coverThumb
  const TypeIcon = collection.type === 'synchronized' ? ViewColumnIcon : ViewCarouselIcon
  const imageCountText = `${collection.imageCount} ${collection.imageCount === 1 ? 'image' : 'images'}`
  const showEdit = Boolean(onEdit) && collection.permissions.canEdit
  const showTransfer = Boolean(onTransfer) && collection.permissions.canTransfer
  const showMove = Boolean(onMove)

  // Restriction chips mirror the category tile (#1567): the collection's own
  // scope renders solid; the filed category's effective scope renders at the
  // inherited opacity.
  const ownProgramIds = collection.visibility === 'restricted' ? collection.programIds : []
  const ownGroupIds = collection.visibility === 'restricted' ? collection.groupIds : []
  const programChips = ownProgramIds
    .map((pid) => programs.find((p) => p.id === pid))
    .filter((p): p is Program => p != null)
  const inheritedProgramChips = inheritedProgramIds
    .filter((pid) => !ownProgramIds.includes(pid))
    .map((pid) => programs.find((p) => p.id === pid))
    .filter((p): p is Program => p != null)
  const groupChips = ownGroupIds
    .map((gid) => groups.find((g) => g.id === gid))
    .filter((g): g is Group => g != null)
  const inheritedGroupChips = inheritedGroupIds
    .filter((gid) => !ownGroupIds.includes(gid))
    .map((gid) => groups.find((g) => g.id === gid))
    .filter((g): g is Group => g != null)

  return (
    <Card data-testid="collection-card" elevation={2} sx={{ height: '100%', position: 'relative' }}>
      <CardActionArea
        data-testid="collection-card-action-area"
        onClick={() => onOpen(collection)}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          // Curatorially hidden tiles desaturate like hidden categories (#1559).
          filter: collection.hidden ? 'grayscale(100%)' : 'none',
        }}
      >
        {cover ? (
          <RenewingThumbnail
            image={{ id: collection.id, thumb: cover }}
            renewThumb={renewCoverThumb}
            alt={collection.name}
            sx={{
              display: 'block',
              width: '100%',
              height: 160,
              objectFit: 'cover',
              objectPosition: 'center',
            }}
          />
        ) : (
          <Box
            sx={{
              height: 160,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'primary.main',
              color: 'white',
            }}
          >
            <CollectionsIcon sx={{ fontSize: 64, opacity: 0.85 }} />
          </Box>
        )}
        <CardContent sx={{ flexGrow: 1, width: '100%' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
            <Tooltip title={collection.name}>
              <Typography
                variant="h6"
                sx={{
                  color: collection.hidden ? visColors.inactive : 'primary.main',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                  pr: showEdit ? 8 : 0,
                }}
              >
                {collection.name}
              </Typography>
            </Tooltip>
            {collection.hidden && (
              <Tooltip title="Visibility: Hidden">
                <span
                  role="img"
                  aria-label="Visibility: Hidden"
                  style={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <VisibilityOff fontSize="small" sx={{ color: visColors.inactive }} />
                </span>
              </Tooltip>
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {imageCountText} · {describeCollectionOwners(collection.owners)}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            <CollectionVisibilityChip visibility={collection.visibility} />
          </Box>
          {/* Own/inherited scope render as separate rows, matching
              CategoryTile (#1567). */}
          {programChips.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {programChips.map((p) => (
                <Chip
                  key={p.id}
                  data-testid="program-chip"
                  label={p.name}
                  size="small"
                  color="primary"
                />
              ))}
            </Box>
          )}
          {inheritedProgramChips.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {inheritedProgramChips.map((p) => (
                <Chip
                  key={p.id}
                  data-testid="program-chip"
                  label={p.name}
                  size="small"
                  color="primary"
                  sx={getInheritedRestrictionSx(true)}
                />
              ))}
            </Box>
          )}
          {groupChips.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {groupChips.map((g) => (
                <Chip
                  key={g.id}
                  data-testid="group-chip"
                  label={g.name}
                  size="small"
                  color="secondary"
                />
              ))}
            </Box>
          )}
          {inheritedGroupChips.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {inheritedGroupChips.map((g) => (
                <Chip
                  key={g.id}
                  data-testid="group-chip"
                  label={g.name}
                  size="small"
                  color="secondary"
                  sx={getInheritedRestrictionSx(true)}
                />
              ))}
            </Box>
          )}
        </CardContent>
      </CardActionArea>
      {/* Cover-overlay controls (#1554/#1559): the type pill pins to the
          top-left; curatorial actions stay top-right — both use the
          CategoryTile scrim convention. */}
      <Box
        data-testid="collection-type-overlay"
        sx={{
          position: 'absolute',
          top: 4,
          left: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        <Chip
          data-testid="collection-type-chip"
          label={COLLECTION_TYPE_LABELS[collection.type]}
          size="small"
          icon={<TypeIcon />}
          sx={{
            bgcolor: 'rgba(0,0,0,0.25)',
            color: 'white',
            '& .MuiChip-icon': { color: 'white' },
          }}
        />
      </Box>
      <Box
        data-testid="collection-actions-overlay"
        sx={{
          position: 'absolute',
          top: 4,
          right: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        {showMove && (
          <Tooltip title="Move to category">
            <IconButton
              size="small"
              sx={{
                color: 'white',
                bgcolor: 'rgba(0,0,0,0.25)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.45)' },
              }}
              aria-label={`Move ${collection.name} to a category`}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onMove?.(collection)
              }}
            >
              <DriveFileMoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {showTransfer && (
          <Tooltip title="Manage owners">
            <IconButton
              size="small"
              sx={{
                color: 'white',
                bgcolor: 'rgba(0,0,0,0.25)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.45)' },
              }}
              aria-label={`Manage owners of ${collection.name}`}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onTransfer?.(collection)
              }}
            >
              <SwapHorizIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {showEdit && (
        <IconButton
          size="small"
          aria-label={`Edit ${collection.name}`}
          onClick={() => onEdit?.(collection)}
          sx={{ position: 'absolute', top: 168, right: 8 }}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      )}
    </Card>
  )
}
