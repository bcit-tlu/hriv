import { useMemo } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { narrowGroupIds, narrowProgramIds } from '../categoryUtils'
import { getCategoryHiddenStateFromPath } from '../treeUtils'
import type { Category, CollectionSummary, Group, Program } from '../types'
import { buildCategoryPaths } from './CategoryBreadcrumb'
import CollectionCard from './CollectionCard'

export interface MyCollectionsShelfProps {
  collections: CollectionSummary[]
  categories: Category[]
  programs: Program[]
  groups?: Group[]
  onOpen: (collection: CollectionSummary) => void
  /** Title edit pencil — the card's `canEdit` gate decides, like Browse. */
  onEdit?: (collection: CollectionSummary) => void
  /** Cover-image picker — the card's `canEdit` gate decides, like Browse. */
  onPickCoverImage?: (collection: CollectionSummary) => void
  onSeeAll: () => void
}

export default function MyCollectionsShelf({
  collections,
  categories,
  programs,
  groups,
  onOpen,
  onEdit,
  onPickCoverImage,
  onSeeAll,
}: MyCollectionsShelfProps) {
  const categoryPaths = useMemo(() => buildCategoryPaths(categories), [categories])

  if (collections.length === 0) return null

  return (
    <Box component="section" aria-labelledby="my-collections-shelf-title" sx={{ mb: 3 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          mb: 2,
        }}
      >
        <Typography id="my-collections-shelf-title" component="h2" variant="h5">
          My collections
        </Typography>
        <Button onClick={onSeeAll}>See all</Button>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
            xl: 'repeat(5, minmax(0, 1fr))',
          },
          gap: 2,
        }}
      >
        {collections.map((collection) => {
          const seg =
            collection.categoryId != null ? categoryPaths.get(collection.categoryId) : undefined
          const catPath = seg ? [...seg.ancestors, seg.category] : []
          return (
            <CollectionCard
              key={collection.id}
              collection={collection}
              onOpen={onOpen}
              onEdit={onEdit}
              onPickCoverImage={onPickCoverImage}
              programs={programs}
              inheritedProgramIds={narrowProgramIds(catPath)}
              groups={groups}
              inheritedGroupIds={narrowGroupIds(catPath)}
              categoryHidden={getCategoryHiddenStateFromPath(catPath).hidden}
            />
          )
        })}
      </Box>
    </Box>
  )
}
