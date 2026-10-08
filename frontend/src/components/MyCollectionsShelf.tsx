import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import type { CollectionSummary, Group, Program } from '../types'
import CollectionCard from './CollectionCard'

export interface MyCollectionsShelfProps {
  collections: CollectionSummary[]
  programs: Program[]
  groups?: Group[]
  onOpen: (collection: CollectionSummary) => void
  onSeeAll: () => void
}

export default function MyCollectionsShelf({
  collections,
  programs,
  groups,
  onOpen,
  onSeeAll,
}: MyCollectionsShelfProps) {
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
        {collections.map((collection) => (
          <CollectionCard
            key={collection.id}
            collection={collection}
            onOpen={onOpen}
            programs={programs}
            groups={groups}
          />
        ))}
      </Box>
    </Box>
  )
}
