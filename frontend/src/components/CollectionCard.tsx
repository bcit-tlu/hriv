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
import ImageIcon from '@mui/icons-material/Image'
import LockIcon from '@mui/icons-material/Lock'
import PublicIcon from '@mui/icons-material/Public'
import ViewCarouselIcon from '@mui/icons-material/ViewCarousel'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import { fetchCollection } from '../api'
import { getInheritedRestrictionSx } from '../restrictionStyles'
import type {
  CollectionSummary,
  CollectionType,
  CollectionVisibility,
  Group,
  Program,
} from '../types'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ComponentProps } from 'react'
import { COLLECTION_TYPE_LABELS, COLLECTION_VISIBILITY_LABELS } from '../collectionUtils'
import { getGroupChipColors, getVisibilityColors } from '../theme'
import { useColorMode } from '../useColorMode'
import RenewingThumbnail from './RenewingThumbnail'

export interface CollectionCardProps {
  collection: CollectionSummary
  onOpen: (collection: CollectionSummary) => void
  /** Rendered only when `collection.permissions.canEdit` (UX gate — the API re-checks). */
  onEdit?: (collection: CollectionSummary) => void
  /**
   * Move/file into a category (#1529). Unlike the other actions this is
   * role-gated by the caller (any admin/instructor may file — it is
   * curatorial, not ownership-bound), so it renders whenever provided.
   */
  onMove?: (collection: CollectionSummary) => void
  /**
   * Open the tile cover picker — the member-pick modal mirrors
   * CategoryTile's "Set card image" button. The summary carries no member
   * list, so the parent loads the collection detail before rendering the
   * modal. Rendered only when `collection.permissions.canEdit`, like the
   * edit pencil.
   */
  onPickCoverImage?: (collection: CollectionSummary) => void
  /** Restriction chip lookup (#1567) — same contract as CategoryTile. */
  programs: Program[]
  /** Effective program restriction inherited from the filed category. */
  inheritedProgramIds?: number[]
  groups?: Group[]
  /** Effective group restriction inherited from the filed category. */
  inheritedGroupIds?: number[]
  titleHeadingLevel?: 'h3' | 'h4' | 'h5' | 'h6'
  density?: 'default' | 'compact'
  /** Filed category (or an ancestor) is hidden — the collection is
   *  invisible to students regardless of its own `hidden` flag; the card
   *  desaturates like an own-hidden tile but carries no marker icon —
   *  the eye-off glyph is reserved for the collection's own hidden flag
   *  (ImageTile's `categoryHidden` convention). */
  categoryHidden?: boolean
}

/**
 * Visibility chip styling mirrors the category restriction chips: `restricted`
 * borrows the group-chip colours (the restricted dimension users already know),
 * `public` is neutral-outlined, `private` uses the muted visibility grey.
 */
export function CollectionVisibilityChip({
  visibility,
  hasScopeChips = false,
}: {
  visibility: CollectionVisibility
  /** Program/group chips render the restriction — when they exist (#1567). */
  hasScopeChips?: boolean
}) {
  const { mode } = useColorMode()
  const groupColors = getGroupChipColors(mode)
  const visColors = getVisibilityColors(mode)
  const label = COLLECTION_VISIBILITY_LABELS[visibility]
  if (visibility === 'restricted') {
    // Scope chips carry the restriction when they render — the pill is
    // redundant then, but an unscoped restricted collection still needs
    // its label (#1567).
    if (hasScopeChips) return null
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

/** Bare type glyph (synchronized columns / sequence carousel) for spots that
    show the icon without the pill — e.g. left of a tile title (#1567). */
export function CollectionTypeIcon({
  type,
  ...props
}: { type: CollectionType } & ComponentProps<typeof ViewCarouselIcon>) {
  const TypeIcon = type === 'synchronized' ? ViewColumnIcon : ViewCarouselIcon
  // Informational-icon convention: a non-interactive `role="img"` span
  // carries the label — not `titleAccess` on the bare SVG (#1567).
  return (
    <Box
      component="span"
      role="img"
      aria-label={COLLECTION_TYPE_LABELS[type]}
      sx={{ display: 'inline-flex' }}
    >
      <TypeIcon {...props} />
    </Box>
  )
}

/**
 * The single collection-type pill look (#1567): red (primary) outline and
 * text on a filled-white surface with the type's icon. Tiles, the detail
 * header, the edit dialog, and the manage table all render this.
 */
export function CollectionTypeChip({ type, sx }: { type: CollectionType; sx?: SxProps<Theme> }) {
  const TypeIcon = type === 'synchronized' ? ViewColumnIcon : ViewCarouselIcon
  return (
    <Chip
      data-testid="collection-type-chip"
      label={COLLECTION_TYPE_LABELS[type]}
      size="small"
      variant="outlined"
      color="primary"
      icon={<TypeIcon />}
      sx={[
        // `background.paper` keeps the white fill over cover imagery while
        // staying legible in dark mode; the 14px icon matches the lock
        // convention (`.MuiChip-icon` defaults to 18px).
        { bgcolor: 'background.paper', '& .MuiChip-icon': { fontSize: 14 } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
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
  onMove,
  onPickCoverImage,
  programs,
  inheritedProgramIds = [],
  groups = [],
  inheritedGroupIds = [],
  titleHeadingLevel = 'h6',
  categoryHidden = false,
  density = 'default',
}: CollectionCardProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  const compact = density === 'compact'
  const titleVariant = compact ? 'subtitle1' : 'h6'
  const cover = collection.coverThumb
  const imageCountText = `${collection.imageCount} ${collection.imageCount === 1 ? 'image' : 'images'}`
  const showEdit = Boolean(onEdit) && collection.permissions.canEdit
  const showMove = Boolean(onMove)
  const showCoverPicker = Boolean(onPickCoverImage) && collection.permissions.canEdit

  // Restriction chips mirror the category tile (#1567): the collection's own
  // scope renders solid; the filed category's effective scope renders at the
  // inherited opacity.
  const ownProgramIds = collection.visibility === 'restricted' ? collection.programIds : []
  const ownGroupIds = collection.visibility === 'restricted' ? collection.groupIds : []
  // The groups list only loads for admin/instructor — fall back to an id
  // label (the detail header's convention) so students still see a chip.
  const programLabel = (id: number) => programs.find((p) => p.id === id)?.name ?? `Program ${id}`
  const groupLabel = (id: number) => groups.find((g) => g.id === id)?.name ?? `Group ${id}`
  const programChips = ownProgramIds.map((id) => ({ id, label: programLabel(id) }))
  const inheritedProgramChips = inheritedProgramIds
    .filter((pid) => !ownProgramIds.includes(pid))
    .map((id) => ({ id, label: programLabel(id) }))
  const groupChips = ownGroupIds.map((id) => ({ id, label: groupLabel(id) }))
  const inheritedGroupChips = inheritedGroupIds
    .filter((gid) => !ownGroupIds.includes(gid))
    .map((id) => ({ id, label: groupLabel(id) }))

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
          // Curatorially hidden tiles desaturate like hidden categories
          // (#1559) — and so do collections filed under a hidden category.
          filter: collection.hidden || categoryHidden ? 'grayscale(100%)' : 'none',
        }}
      >
        {cover ? (
          <RenewingThumbnail
            image={{ id: collection.id, thumb: cover }}
            renewThumb={renewCoverThumb}
            alt={collection.name}
            style={compact ? { width: '100%', aspectRatio: '4 / 3', height: 'auto' } : undefined}
            sx={{
              display: 'block',
              ...(compact ? {} : { width: '100%', height: 140 }),
              objectFit: 'cover',
              objectPosition: 'center',
            }}
          />
        ) : (
          <Box
            sx={{
              ...(compact
                ? { width: '100%', aspectRatio: '4 / 3', height: 'auto' }
                : { height: 140 }),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'primary.main',
              color: 'white',
            }}
          >
            <CollectionsIcon sx={{ fontSize: compact ? 40 : 64, opacity: 0.85 }} />
          </Box>
        )}
        <CardContent
          sx={{
            flexGrow: 1,
            width: '100%',
            ...(compact ? { p: 1.5, '&:last-child': { pb: 1.5 } } : {}),
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
            {/* Type icon left of the title — the CategoryTile folder-icon
                convention (#1567). `titleAccess` names it for screen readers.
                The span wrapper centres the glyph on the title's first line —
                bare flex-start leaves it floating above the text. */}
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                typography: titleVariant,
                height: '1lh',
                flexShrink: 0,
              }}
            >
              <Tooltip title={COLLECTION_TYPE_LABELS[collection.type]}>
                <CollectionTypeIcon
                  type={collection.type}
                  fontSize="small"
                  color="primary"
                  sx={{ flexShrink: 0 }}
                />
              </Tooltip>
            </Box>
            <Tooltip title={collection.name}>
              <Typography
                component={titleHeadingLevel}
                variant={titleVariant}
                sx={{
                  color: collection.hidden || categoryHidden ? visColors.inactive : 'primary.main',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                }}
              >
                {collection.name}
              </Typography>
            </Tooltip>
            {/* The eye-off marker is reserved for the collection's own
                `hidden` flag — category-hidden desaturation alone conveys
                the inherited state (ImageTile's convention). */}
            {collection.hidden && (
              <Tooltip title="Visibility: Hidden">
                <Box
                  component="span"
                  role="img"
                  aria-label="Visibility: Hidden"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    typography: titleVariant,
                    height: '1lh',
                    flexShrink: 0,
                  }}
                >
                  <VisibilityOff fontSize="small" sx={{ color: visColors.inactive }} />
                </Box>
              </Tooltip>
            )}
            {/* Edit pencil sits directly right of the title — the
                CategoryTile/ImageTile convention (#1567). */}
            {showEdit && (
              <IconButton
                component="span"
                size="small"
                aria-label={`Edit ${collection.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onEdit?.(collection)
                }}
                sx={{
                  flexShrink: 0,
                  ml: 0.25,
                  ...(compact ? { typography: 'subtitle1' } : {}),
                }}
              >
                <EditIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>
          {/* Owner names were removed from tile metadata (#1567): a
              program-owned collection shows its program as a chip under the
              type pill; user-owned tiles carry no owner reference. */}
          <Typography variant="body2" color="text.secondary">
            {imageCountText}
          </Typography>
          {/* The visibility row mounts only when a pill renders — a
              restricted collection with scope chips shows no pill
              (#1567), and an empty row would add a phantom gap the
              category tiles don't have. `mt: 0.5` matches CategoryTile's
              chip-row spacing. */}
          {!(
            collection.visibility === 'restricted' &&
            (programChips.length > 0 || groupChips.length > 0)
          ) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              <CollectionVisibilityChip
                visibility={collection.visibility}
                hasScopeChips={programChips.length > 0 || groupChips.length > 0}
              />
            </Box>
          )}
          {/* Own/inherited scope render as separate rows, matching
              CategoryTile (#1567). */}
          {programChips.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {programChips.map((p) => (
                <Chip
                  key={p.id}
                  data-testid="program-chip"
                  label={p.label}
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
                  label={p.label}
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
                  label={g.label}
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
                  label={g.label}
                  size="small"
                  color="secondary"
                  sx={getInheritedRestrictionSx(true)}
                />
              ))}
            </Box>
          )}
        </CardContent>
      </CardActionArea>
      {/* Cover-overlay controls (#1554/#1559): curatorial actions pin
          top-right (CategoryTile scrim convention). The type/owner overlay
          chips were removed in #1567 — the type icon sits by the title. */}
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
        {showCoverPicker && (
          <Tooltip title="Set cover image">
            <IconButton
              size="small"
              sx={{
                color: 'white',
                bgcolor: 'rgba(0,0,0,0.25)',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.45)' },
              }}
              aria-label={`Set ${collection.name} cover image`}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onPickCoverImage?.(collection)
              }}
            >
              <ImageIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
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
      </Box>
    </Card>
  )
}
