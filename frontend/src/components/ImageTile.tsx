import { memo } from 'react'

import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardMedia from '@mui/material/CardMedia'
import CardContent from '@mui/material/CardContent'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import type { ImageItem } from '../types'
import { useColorMode } from '../useColorMode'
import { getVisibilityColors } from '../theme'
import { useIsMobile } from '../useIsMobile'

interface ImageTileProps {
  image: ImageItem
  onClick: (image: ImageItem) => void
  onEditDetails?: (image: ImageItem) => void
  /** When true the parent category is hidden, so this tile is desaturated. */
  categoryHidden?: boolean
}

function ImageTile({ image, onClick, onEditDetails, categoryHidden = false }: ImageTileProps) {
  const { mode } = useColorMode()
  const visColors = getVisibilityColors(mode)
  const isMobile = useIsMobile()
  return (
    <Card
      elevation={2}
      sx={{
        width: '100%',
        maxWidth: 300,
        position: 'relative',
        opacity: categoryHidden ? 0.5 : 1,
        // Mobile matches the design's flat card (hairline border, 8px radius).
        ...(isMobile && {
          boxShadow: 'none',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }),
      }}
    >
      <CardActionArea
        onClick={() => onClick(image)}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          alignItems: 'stretch',
          filter: categoryHidden || !image.active ? 'grayscale(100%)' : 'none',
        }}
      >
        <CardMedia
          component="img"
          image={image.thumb}
          alt={image.name}
          sx={{ height: isMobile ? 88 : 160, objectFit: 'cover', objectPosition: 'center' }}
        />
        <CardContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            p: isMobile ? '8px 10px' : 2,
            '&:last-child': { pb: isMobile ? '8px' : 2 },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography
              variant="h6"
              noWrap={!isMobile}
              sx={{
                ...(!image.active && { color: visColors.inactive }),
                ...(isMobile && {
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  whiteSpace: 'normal',
                }),
              }}
            >
              {image.name}
            </Typography>
            {!image.active && (
              <Tooltip title="Visibility: Inactive">
                <span
                  role="img"
                  aria-label="Visibility: Inactive"
                  style={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <VisibilityOff fontSize="small" sx={{ color: visColors.inactive }} />
                </span>
              </Tooltip>
            )}
            {onEditDetails && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onEditDetails(image)
                }}
                aria-label="Edit image details"
                sx={{ flexShrink: 0, ml: 0.25 }}
              >
                <EditIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>
          {image.copyright && (
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ mt: isMobile ? 0.25 : 1, fontSize: isMobile ? 13 : 'inherit' }}
            >
              &copy; {image.copyright}
            </Typography>
          )}
          <Box sx={{ flexGrow: 1 }} />
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

// Memoized: Browse can mount hundreds of image tiles, and grid-level state
// changes (drag start/end, optimistic reorder) would otherwise re-render
// every card. Props are stable references from the grid.
export default memo(ImageTile)
