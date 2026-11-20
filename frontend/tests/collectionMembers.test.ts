import { expect, it, vi } from 'vitest'
import {
  memberKey,
  memberSlotInput,
  memberViewport,
  renewSlotThumbnail,
} from '../src/collectionMembers'
import { parseCollectionSlotParam } from '../src/collectionUtils'
import * as api from '../src/api'
import { makeApiCollection, makeImage } from './helpers/fixtures'
import { MARKER_FIXTURE } from '../src/components/markerFixtures'

it('keeps image identity separate from persisted and draft member keys', () => {
  const image = makeImage({ id: 100 })
  const slot = { id: 11, viewport_state: null, label: null, thumb: null }
  expect(memberKey(image)).toBe(100)
  expect(memberKey({ ...image, slot })).toBe(11)
  expect(memberKey({ ...image, draftKey: -1 })).toBe(-1)
  expect(memberSlotInput({ ...image, slot })).toEqual({ image_id: 100, id: 11 })
  expect(memberSlotInput({ ...image, slot: { ...slot, id: -1 } })).toEqual({ image_id: 100 })
  expect(memberSlotInput({ ...image, slot, draftKey: -1, markerId: 8 })).toEqual({
    image_id: 100,
    marker_id: 8,
  })
  expect(memberViewport({ ...image, slot }, { '100': { x: 0.3 } })).toEqual({ x: 0.3 })
})

it('parses a collection-scoped slot URL without conflating image ids', () => {
  expect(parseCollectionSlotParam('?collection=7&slot=11&item=100')).toBe(11)
  for (const value of [
    '?slot=11',
    '?collection=7&slot=0',
    '?collection=7&slot=NaN',
    '?collection=7&slot=1.2',
    '?collection=7&slot=9007199254740992',
  ]) {
    expect(parseCollectionSlotParam(value)).toBeNull()
  }
})

it('renews crops by slot id rather than picking the first matching source image', async () => {
  const image = makeImage({ id: 100 })
  const first = { id: 11, viewport_state: null, label: 'Left', thumb: '/old-left.jpg' }
  const second = { ...first, id: 12, label: 'Right', thumb: '/right.jpg?token=new' }
  const request = vi.spyOn(api, 'fetchCollection').mockResolvedValue(
    makeApiCollection({
      images: [first, second].map((slot) => ({
        id: 100,
        name: 'Slide',
        active: true,
        thumb: '/image.jpg',
        tile_sources: '/image.dzi',
        category_id: 1,
        copyright: null,
        note: null,
        sort_order: 0,
        version: 1,
        created_at: null,
        updated_at: null,
        metadata_extra: null,
        width: null,
        height: null,
        file_size: null,
        slot,
      })),
    }),
  )
  await expect(renewSlotThumbnail(7, { ...image, slot: second })).resolves.toEqual({
    id: 100,
    thumb: second.thumb,
  })
  request.mockRejectedValueOnce(new Error('No longer visible'))
  await expect(renewSlotThumbnail(7, { ...image, slot: second })).rejects.toThrow(
    'No longer visible',
  )
  request.mockResolvedValueOnce(makeApiCollection({ images: [] }))
  await expect(renewSlotThumbnail(7, { ...image, slot: second })).resolves.toEqual({
    id: 100,
    thumb: null,
  })
  request.mockRestore()
})

it('renews an uncommitted Board crop through its source without writing the Marker', async () => {
  const request = vi
    .spyOn(api, 'fetchMarker')
    .mockResolvedValue({ ...MARKER_FIXTURE, thumb: '/source.jpg?token=new' })
  await expect(
    renewSlotThumbnail(7, { ...makeImage({ id: 100 }), draftKey: -1, markerId: 8 }),
  ).resolves.toEqual({ id: 100, thumb: '/source.jpg?token=new' })
  expect(request).toHaveBeenCalledWith(8)
  request.mockRestore()
})
