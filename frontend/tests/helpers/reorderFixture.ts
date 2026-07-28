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

/** Pairwise-collapsed sort orders (0,0,1,1,…) guarantee duplicates. */
export function duplicatedSortOrder(index: number): number {
  return Math.floor(index / 2)
}

/** 80 deterministic sibling categories with duplicate sortOrder values. */
export function makeFlatCategoryScope(parentId: number | null = null): Category[] {
  return Array.from({ length: FLAT_SIBLING_CATEGORY_COUNT }, (_, i) =>
    makeCategory({
      id: CATEGORY_ID_BASE + i,
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
      id: IMAGE_ID_BASE + i,
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
  const categories = Array.from({ length: 5 }, (_, i) =>
    makeCategory({
      id: CATEGORY_ID_BASE + 500 + i,
      label: `${FIXTURE_PREFIX}Root-${String(i + 1).padStart(2, '0')}`,
      sortOrder: duplicatedSortOrder(i),
    }),
  )
  const uncategorizedImages = Array.from({ length: 10 }, (_, i) =>
    makeImage({
      id: IMAGE_ID_BASE + 5000 + i,
      name: `${FIXTURE_PREFIX}Uncat-Img-${String(i + 1).padStart(2, '0')}`,
      sortOrder: duplicatedSortOrder(i),
    }),
  )
  return { categories, uncategorizedImages }
}

export interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

/**
 * Manually settled promise for delaying persistence or refresh calls —
 * lets a test start a save, interleave other operations, then release it.
 */
export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
