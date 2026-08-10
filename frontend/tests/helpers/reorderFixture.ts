/**
 * Production-scale reorder fixture for frontend tests (epic #975, #976).
 *
 * Mirrors the backend fixture in `backend/app/reorder_fixture.py`:
 * deterministic IDs/names, 80 sibling categories, 600 sibling images,
 * a mixed root scope, and duplicate initial sortOrder values. Also provides
 * latency-injection helpers (deferreds) so tests can hold category and image
 * persistence — and background refreshes — open independently.
 */

import type { Category, ImageItem } from '../../src/types'
import { makeCategory, makeImage } from './fixtures'

export const FIXTURE_PREFIX = 'RF-'
export const CATEGORY_ID_BASE = 9_100_000
export const IMAGE_ID_BASE = 9_200_000
export const FLAT_SIBLING_CATEGORY_COUNT = 80
export const GALLERY_SIBLING_IMAGE_COUNT = 600
export const ROOT_MIXED_CATEGORY_COUNT = 5
export const ROOT_UNCATEGORIZED_IMAGE_COUNT = 10

// The backend fixture (backend/app/reorder_fixture.py) assigns IDs
// sequentially: root categories first, then the flat scope; uncategorized
// images first, then the gallery scope. Mirror that numbering exactly so a
// given RF- name maps to the same ID in both generators.
const FLAT_CATEGORY_ID_START = CATEGORY_ID_BASE + ROOT_MIXED_CATEGORY_COUNT
const GALLERY_IMAGE_ID_START = IMAGE_ID_BASE + ROOT_UNCATEGORIZED_IMAGE_COUNT

/** Pairwise-collapsed sort orders (0,0,1,1,…) guarantee duplicates. */
export function duplicatedSortOrder(index: number): number {
  return Math.floor(index / 2)
}

/** 80 deterministic sibling categories with duplicate sortOrder values. */
export function makeFlatCategoryScope(parentId: number | null = CATEGORY_ID_BASE): Category[] {
  return Array.from({ length: FLAT_SIBLING_CATEGORY_COUNT }, (_, i) =>
    makeCategory({
      id: FLAT_CATEGORY_ID_START + i,
      label: `${FIXTURE_PREFIX}Flat-Cat-${String(i + 1).padStart(3, '0')}`,
      parentId,
      sortOrder: duplicatedSortOrder(i),
    }),
  )
}

/** 600 deterministic sibling images with duplicate sortOrder values. */
export function makeGalleryImageScope(): ImageItem[] {
  return Array.from({ length: GALLERY_SIBLING_IMAGE_COUNT }, (_, i) =>
    makeImage({
      id: GALLERY_IMAGE_ID_START + i,
      name: `${FIXTURE_PREFIX}Gallery-Img-${String(i + 1).padStart(3, '0')}`,
      sortOrder: duplicatedSortOrder(i),
    }),
  )
}

/** Mixed root scope: sibling root categories plus uncategorized images. */
export function makeMixedRootScope(): {
  categories: Category[]
  uncategorizedImages: ImageItem[]
} {
  const categories = Array.from({ length: ROOT_MIXED_CATEGORY_COUNT }, (_, i) =>
    makeCategory({
      id: CATEGORY_ID_BASE + i,
      label: `${FIXTURE_PREFIX}Root-${String(i + 1).padStart(2, '0')}`,
      sortOrder: duplicatedSortOrder(i),
    }),
  )
  const uncategorizedImages = Array.from({ length: ROOT_UNCATEGORIZED_IMAGE_COUNT }, (_, i) =>
    makeImage({
      id: IMAGE_ID_BASE + i,
      name: `${FIXTURE_PREFIX}Uncat-Img-${String(i + 1).padStart(2, '0')}`,
      sortOrder: duplicatedSortOrder(i),
    }),
  )
  return { categories, uncategorizedImages }
}

