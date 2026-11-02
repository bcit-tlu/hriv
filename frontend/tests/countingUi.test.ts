/**
 * countingUi helpers (#1667): level-0 selection clamping — both endpoints
 * must clamp so a rect drawn past an image edge keeps only what's inside.
 */

import { describe, it, expect } from 'vitest'
import OpenSeadragon from 'openseadragon'

import { selectionToLevel0 } from '../src/countingUi'

function viewerFor(size: { x: number; y: number }) {
  return {
    world: { getItemAt: () => ({ getContentSize: () => size }) },
    // Identity transform: viewport rect == level-0 rect for these tests.
    viewport: {
      viewportToImageRectangle: (r: OpenSeadragon.Rect) => r,
    },
  } as unknown as OpenSeadragon.Viewer
}

const SIZE = { x: 1000, y: 800 }

describe('selectionToLevel0', () => {
  it('clamps a left/top overhang: interior only, shrunk width/height', () => {
    // -20,-20 → 80,80 interior.
    expect(selectionToLevel0(viewerFor(SIZE), { x: -20, y: -20, width: 100, height: 100 })).toEqual(
      { x: 0, y: 0, width: 80, height: 80 },
    )
  })

  it('clamps a right/bottom overhang', () => {
    expect(selectionToLevel0(viewerFor(SIZE), { x: 900, y: 700, width: 300, height: 300 })).toEqual(
      { x: 900, y: 700, width: 100, height: 100 },
    )
  })

  it('returns null for a fully-outside rect', () => {
    expect(
      selectionToLevel0(viewerFor(SIZE), { x: -200, y: -200, width: 50, height: 50 }),
    ).toBeNull()
    expect(
      selectionToLevel0(viewerFor(SIZE), { x: 2000, y: 2000, width: 50, height: 50 }),
    ).toBeNull()
  })

  it('floors the start and ceils the end of inside rects', () => {
    expect(
      selectionToLevel0(viewerFor(SIZE), { x: 10.2, y: 20.6, width: 100.5, height: 80.4 }),
    ).toEqual({ x: 10, y: 20, width: 101, height: 81 })
  })
})
