import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import type { Category } from '../types'
import { getCategoryHiddenStateFromPath } from '../treeUtils'

export interface CategoryPathSegment {
  category: Category
  ancestors: Category[]
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildCategoryPaths(
  nodes: Category[],
  ancestors: Category[] = [],
): Map<number, CategoryPathSegment> {
  const map = new Map<number, CategoryPathSegment>()
  for (const node of nodes) {
    map.set(node.id, { category: node, ancestors })
    const childMap = buildCategoryPaths(node.children, [...ancestors, node])
    for (const [id, seg] of childMap) {
      map.set(id, seg)
    }
  }
  return map
}

/**
 * Colon-separated ancestor path rendered as per-segment links; extracted
 * from ManagePage so the collections manage table (#1554) shows the same
 * browse-location breadcrumb for a collection's filed category.
 */
export default function CategoryBreadcrumb({
  categoryId,
  categoryPaths,
  onNavigate,
  hiddenColor,
}: {
  categoryId: number | null
  categoryPaths: Map<number, CategoryPathSegment>
  onNavigate?: (categoryPath: Category[]) => void
  hiddenColor?: string
}) {
  if (categoryId == null) return <>—</>
  const seg = categoryPaths.get(categoryId)
  if (!seg) return <>{categoryId}</>

  const fullPath = [...seg.ancestors, seg.category]
  const hiddenState = getCategoryHiddenStateFromPath(fullPath)

  return (
    <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center' }}>
      {fullPath.map((cat, i) => (
        <Box component="span" key={cat.id}>
          {i > 0 && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ mx: 0.25 }}>
              :
            </Typography>
          )}
          <Link
            component="button"
            variant="body2"
            underline="hover"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              if (onNavigate) {
                onNavigate(fullPath.slice(0, i + 1))
              }
            }}
            sx={{ verticalAlign: 'baseline' }}
          >
            {cat.label}
          </Link>
        </Box>
      ))}
      {hiddenState.hidden && hiddenColor && (
        <Tooltip title="Hidden by category">
          <span
            role="img"
            aria-label={
              hiddenState.hiddenByAncestor && !hiddenState.directlyHidden
                ? 'Category hidden from students by ancestor'
                : 'Category hidden from students'
            }
            style={{ display: 'inline-flex', marginLeft: 4, verticalAlign: 'middle' }}
          >
            <VisibilityOffIcon
              sx={{
                fontSize: 14,
                color: hiddenColor,
              }}
            />
          </span>
        </Tooltip>
      )}
    </Box>
  )
}
