import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined'
import { fetchBoard, fetchMarker, fetchMarkers } from '../api'
import type { ApiBoardSummary, ApiMarker } from '../types'
import RenewingThumbnail from './RenewingThumbnail'

/** Board cover: the pinned cover, else the first member thumbnail, else the
 *  Boards icon. */
export default function BoardCover({
  board,
  size = 70,
  radius = 0,
}: {
  board: ApiBoardSummary
  size?: number
  radius?: number
}) {
  const [state, setState] = useState<{ id: number; items: ApiMarker[] } | null>(null)
  const key = `${board.id}:${board.version}`
  useEffect(() => {
    // An explicit "no cover" pick renders the placeholder — no member
    // fetch needed.
    if (board.cover_blank) return
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
  }, [board.id, board.cover_blank, key])
  const item =
    !board.cover_blank && state?.id === board.id
      ? state.items.find((item) => item.thumb != null)
      : undefined
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        bgcolor: 'action.hover',
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
      ) : (
        <SpaceDashboardOutlined
          sx={{ fontSize: Math.round(size * 0.46), color: 'text.secondary' }}
        />
      )}
    </Box>
  )
}
