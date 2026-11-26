import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined'
import type { ApiBoardSummary } from '../types'
import BoardCover from './BoardCover'
import { CollectionVisibilityChip } from './CollectionCard'

export interface BoardCardProps {
  board: ApiBoardSummary
  onOpen: (board: ApiBoardSummary) => void
}

/**
 * Board card in the CategoryTile/CollectionCard style (#1978): full-width
 * cover, Boards icon + brand-red title, Marker count and scope chip. The whole
 * face is a `CardActionArea`, so it gets the same ripple and hover/focus
 * highlight as category cards — there is no persistent selected state.
 */
export default function BoardCard({ board, onOpen }: BoardCardProps) {
  const markerCount = `${board.marker_count} ${board.marker_count === 1 ? 'Marker' : 'Markers'}`
  return (
    <Card data-testid="board-card" elevation={2} sx={{ height: '100%', position: 'relative' }}>
      <CardActionArea
        onClick={() => onOpen(board)}
        aria-label={`Open Board: ${board.name}`}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
        }}
      >
        <BoardCover board={board} banner />
        <CardContent sx={{ flexGrow: 1, width: '100%' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
            {/* Centres the icon on the title's first line (CategoryTile's folder). */}
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                typography: 'h6',
                height: '1lh',
                flexShrink: 0,
              }}
            >
              <SpaceDashboardOutlined color="primary" sx={{ fontSize: 24 }} />
            </Box>
            <Tooltip title={board.name}>
              <Typography
                component="h3"
                variant="h6"
                sx={{
                  color: 'primary.main',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                }}
              >
                {board.name}
              </Typography>
            </Tooltip>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {markerCount}
          </Typography>
          <Box sx={{ display: 'flex', mt: 0.5 }}>
            <CollectionVisibilityChip visibility={board.visibility} />
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
