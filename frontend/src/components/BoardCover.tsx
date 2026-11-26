import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import SpaceDashboard from '@mui/icons-material/SpaceDashboard'
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined'
import { fetchBoard, fetchMarker, fetchMarkers } from '../api'
import type { ApiBoardSummary, ApiMarker } from '../types'
import RenewingThumbnail from './RenewingThumbnail'

/** Board cover: the pinned cover, else the first member thumbnail, else the
 *  Boards icon. `banner` fills a card's full width at the 140px cover height
 *  of CategoryTile/CollectionCard, with their brand-red no-cover fallback (#1978). */
export default function BoardCover({
  board,
  size = 70,
  radius = 0,
  banner = false,
}: {
  board: ApiBoardSummary
  size?: number
  radius?: number
  banner?: boolean
}) {
  const [state, setState] = useState<{ id: number; items: ApiMarker[] } | null>(null)
  const key = `${board.id}:${board.version}`
  // The summary already carries the pinned/first-member thumbnail; only look
  // further when it has none and there are members to look through.
  const needsLookup = !board.cover_blank && !board.cover_thumb && board.marker_count > 0
  useEffect(() => {
    if (!needsLookup) return
    let active = true
    void fetchMarkers({ board_id: board.id, limit: 4 }).then(
      (items) => {
        if (active) setState({ id: board.id, items })
      },
      () => {
        if (active)
          setState((previous) =>
            previous?.id === board.id ? previous : { id: board.id, items: [] },
          )
      },
    )
    return () => {
      active = false
    }
  }, [board.id, needsLookup, key])
  const item =
    needsLookup && state?.id === board.id
      ? state.items.find((item) => item.thumb != null)
      : undefined
  return (
    <Box
      sx={{
        width: banner ? '100%' : size,
        height: banner ? 140 : size,
        borderRadius: radius,
        flexShrink: 0,
        bgcolor: banner ? 'primary.main' : 'action.hover',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}
    >
      {board.cover_thumb && !board.cover_blank ? (
        <RenewingThumbnail
          image={{ id: board.id, thumb: board.cover_thumb }}
          renewThumb={async (id) => {
            const fresh = await fetchBoard(id)
            return { id, thumb: fresh.cover_thumb }
          }}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : item ? (
        <RenewingThumbnail
          image={{ id: item.id, thumb: item.thumb ?? '' }}
          renewThumb={fetchMarker}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : banner ? (
        <SpaceDashboard sx={{ fontSize: 64, opacity: 0.85, color: 'common.white' }} />
      ) : (
        <SpaceDashboardOutlined
          sx={{ fontSize: Math.round(size * 0.46), color: 'text.secondary' }}
        />
      )}
    </Box>
  )
}
