/**
 * Tile memoization (epic #975, issue #981).
 *
 * Browse can mount hundreds of tiles; grid-level state changes (drag
 * start/end, optimistic reorder) must not re-render every card. ImageTile and
 * CategoryTile are memoized, so a parent re-render with stable props must not
 * re-execute them. Render counts are observed through the useColorMode hook,
 * which both tiles call exactly once per render.
 */
import { useState } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ImageTile from '../../src/components/ImageTile'
import CategoryTile from '../../src/components/CategoryTile'
import { useColorMode } from '../../src/useColorMode'
import type { Category, ImageItem, Program } from '../../src/types'

vi.mock('../../src/useColorMode', () => ({
  useColorMode: vi.fn(() => ({ mode: 'light', toggleColorMode: () => {} })),
}))

const mockedUseColorMode = vi.mocked(useColorMode)

const image: ImageItem = {
  id: 1,
  name: 'Img',
  thumb: 'thumb.jpg',
  full: 'full.jpg',
  active: true,
} as ImageItem

const category: Category = {
  id: 2,
  label: 'Cat',
  images: [],
  children: [],
  programIds: [],
  groupIds: [],
} as unknown as Category

const noop = () => {}
const noPrograms: Program[] = []

function ImageHarness() {
  const [n, setN] = useState(0)
  return (
    <>
      <button onClick={() => setN(n + 1)}>bump {n}</button>
      <ImageTile image={image} onClick={noop} />
    </>
  )
}

function CategoryHarness() {
  const [n, setN] = useState(0)
  return (
    <>
      <button onClick={() => setN(n + 1)}>bump {n}</button>
      <CategoryTile category={category} onClick={noop} programs={noPrograms} />
    </>
  )
}

beforeEach(() => {
  mockedUseColorMode.mockClear()
})

describe('tile memoization', () => {
  it('ImageTile does not re-render when the parent re-renders with stable props', () => {
    render(<ImageHarness />)
    const rendersAfterMount = mockedUseColorMode.mock.calls.length
    expect(rendersAfterMount).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /bump/ }))
    fireEvent.click(screen.getByRole('button', { name: /bump/ }))

    expect(mockedUseColorMode.mock.calls.length).toBe(rendersAfterMount)
  })

  it('ImageTile re-renders when its image prop changes', () => {
    const { rerender } = render(<ImageTile image={image} onClick={noop} />)
    const rendersAfterMount = mockedUseColorMode.mock.calls.length

    rerender(<ImageTile image={{ ...image, name: 'Renamed' }} onClick={noop} />)

    expect(screen.getByText('Renamed')).toBeInTheDocument()
    expect(mockedUseColorMode.mock.calls.length).toBeGreaterThan(rendersAfterMount)
  })

  it('CategoryTile does not re-render when the parent re-renders with stable props', () => {
    render(<CategoryHarness />)
    const rendersAfterMount = mockedUseColorMode.mock.calls.length
    expect(rendersAfterMount).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /bump/ }))
    fireEvent.click(screen.getByRole('button', { name: /bump/ }))

    expect(mockedUseColorMode.mock.calls.length).toBe(rendersAfterMount)
  })
})
