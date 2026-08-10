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
import { act, fireEvent, render, screen } from '@testing-library/react'

import ImageTile from '../../src/components/ImageTile'
import CategoryTile from '../../src/components/CategoryTile'
import SortableTileGrid from '../../src/components/SortableTileGrid'
import { useColorMode } from '../../src/useColorMode'
import type { Category, ImageItem, Program } from '../../src/types'
import { makeCategory, makeImage } from '../helpers/fixtures'

vi.mock('../../src/useColorMode', () => ({
  useColorMode: vi.fn(() => ({ mode: 'light', toggleColorMode: () => {} })),
}))

// Capture the grid's drag handlers so a drag start (grid-level state change)
// can be simulated directly.
type DragStartHandler = (event: { operation: { source: { id: string } | null } }) => void
let capturedOnDragStart: DragStartHandler | undefined

vi.mock('@dnd-kit/react', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/react')>('@dnd-kit/react')
  return {
    ...actual,
    DragDropProvider: (props: Record<string, unknown>) => {
      capturedOnDragStart = props.onDragStart as DragStartHandler | undefined
      const ActualProvider = actual.DragDropProvider as React.ComponentType<Record<string, unknown>>
      return <ActualProvider {...props} />
    },
  }
})

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

describe('GridTile memoization inside SortableTileGrid', () => {
  function renderGrid() {
    return render(
      <SortableTileGrid
        allCategories={[]}
        currentCategories={[
          makeCategory({ id: 1, label: 'Alpha', sortOrder: 0 }),
          makeCategory({ id: 2, label: 'Beta', sortOrder: 1 }),
        ]}
        currentImages={[
          makeImage({ id: 10, name: 'Slide A', sortOrder: 2 }),
          makeImage({ id: 11, name: 'Slide B', sortOrder: 3 }),
        ]}
        uncategorizedImages={[]}
        path={[]}
        canEditContent={true}
        fileDragActive={false}
        programs={noPrograms}
        onCategoryClick={noop}
        onImageClick={noop}
        onFilesDrop={noop}
        onDropImageOnCategory={noop}
        onReorderComplete={noop}
        onReorderError={noop}
      />,
    )
  }

  it('a drag start (grid-level state change) does not re-render the mounted tiles', () => {
    renderGrid()
    expect(capturedOnDragStart).toBeDefined()
    const rendersAfterMount = mockedUseColorMode.mock.calls.length
    expect(rendersAfterMount).toBeGreaterThanOrEqual(4)

    act(() => {
      capturedOnDragStart?.({ operation: { source: { id: 'cat-1' } } })
    })

    // setActiveItem re-renders the grid, but the mounted GridTile wrappers
    // are memoized with stable render props, so none of the tile components
    // re-execute. (The drag-overlay copy only mounts during a real dnd-kit
    // drag operation, not for this directly-invoked handler.)
    expect(mockedUseColorMode.mock.calls.length).toBe(rendersAfterMount)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})
