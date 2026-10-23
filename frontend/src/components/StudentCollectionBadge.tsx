import { useId } from 'react'
import Box from '@mui/material/Box'
import { useTheme, type SxProps, type Theme } from '@mui/material/styles'
import {
  STUDENT_BADGE_ELLIPSES,
  STUDENT_BADGE_PATHS,
  STUDENT_BADGE_RIM,
  STUDENT_BADGE_STROKE,
  STUDENT_BADGE_VIEWBOX,
  STUDENT_CURATED_COLOR,
} from '../studentCollectionBadge'

export const STUDENT_CURATED_BADGE_LABEL = 'Student-curated collection'

/**
 * The marbling-disc marker for student-curated collections (creator or
 * any co-owner is a student): it rides the scope cluster everywhere a
 * collection's scope chip renders — right of the visibility pill on the
 * tile and detail header (left of the tile's top-most scope chip when a
 * restricted collection replaces the pill), at the end of the table's
 * Scope cell — plus the graph legend; the canvas renderer paints the
 * same geometry inside student collection nodes. Non-interactive
 * informational icon following the `CollectionTypeIcon` convention: the
 * wrapping span carries `role="img"` + `aria-label`.
 */
export default function StudentCollectionBadge({
  size = 20,
  sx,
}: {
  size?: number
  sx?: SxProps<Theme>
}) {
  const theme = useTheme()
  // `useId` may contain ':' — strip it so the id is safe inside url(#…).
  const clipId = `scb-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <Box
      component="span"
      role="img"
      aria-label={STUDENT_CURATED_BADGE_LABEL}
      sx={[{ display: 'inline-flex', lineHeight: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${STUDENT_BADGE_VIEWBOX} ${STUDENT_BADGE_VIEWBOX}`}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <clipPath id={clipId}>
            <circle cx={256} cy={256} r={256} />
          </clipPath>
        </defs>
        {/* Paper disc so the pattern reads over covers, chips and text —
            fills the disc edge like the canvas node's paper fill. */}
        <circle cx={256} cy={256} r={256} fill={theme.palette.background.paper} />
        <g
          clipPath={`url(#${clipId})`}
          fill="none"
          stroke={STUDENT_CURATED_COLOR}
          strokeWidth={STUDENT_BADGE_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {STUDENT_BADGE_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
          {STUDENT_BADGE_ELLIPSES.map(([cx, cy, rx, ry]) => (
            <ellipse key={`${cx},${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} />
          ))}
        </g>
        {/* Rim ring — the "outline" half of the marker; the outer edge
            lands on the disc boundary like the canvas rim ring. */}
        <circle
          cx={256}
          cy={256}
          r={256 - STUDENT_BADGE_RIM / 2}
          fill="none"
          stroke={STUDENT_CURATED_COLOR}
          strokeWidth={STUDENT_BADGE_RIM}
        />
      </svg>
    </Box>
  )
}
