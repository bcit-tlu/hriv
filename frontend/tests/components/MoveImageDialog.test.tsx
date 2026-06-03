import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoveImageDialog from '../../src/components/MoveImageDialog'
import type { ApiImage } from '../../src/api'
import type { Category } from '../../src/types'

// Mock CategoryPickerSelect
vi.mock('../../src/components/CategoryPickerSelect', () => ({
  default: ({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) => (
    <select
      data-testid="category-picker"
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Root</option>
      <option value="5">Category 5</option>
    </select>
  ),
}))

const image: ApiImage = {
  id: 1,
  name: 'test.jpg',
  thumb: '/t/1',
  tile_sources: '/tiles/1',
  category_id: 5,
  copyright: null,
  note: null,
  program_ids: [],
  active: true,
  sort_order: 0,
  metadata_extra: null,
  version: 1,
  width: 100,
  height: 100,
  file_size: 1024,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const categories: Category[] = [
  { id: 5, label: 'Architecture', parentId: null, children: [], images: [], sortOrder: 0 },
]

describe('MoveImageDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders title and image name', () => {
    render(
      <MoveImageDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        image={image}
        categories={categories}
      />,
    )
    expect(screen.getByText('Move Image')).toBeInTheDocument()
    expect(screen.getByText(/test\.jpg/)).toBeInTheDocument()
  })

  it('calls onMove with selected category when Move is clicked', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn().mockResolvedValue(undefined)
    render(
      <MoveImageDialog
        open
        onClose={vi.fn()}
        onMove={onMove}
        image={image}
        categories={categories}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(onMove).toHaveBeenCalled()
    })
  })

  it('shows "Moving..." text while saving', async () => {
    let resolveFn: () => void
    const onMove = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => { resolveFn = resolve }),
    )
    const user = userEvent.setup()
    render(
      <MoveImageDialog
        open
        onClose={vi.fn()}
        onMove={onMove}
        image={image}
        categories={categories}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(screen.getByText('Moving…')).toBeInTheDocument()
    })
    // Cancel button should be disabled while saving
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()

    // Resolve the promise
    resolveFn!()
  })

  it('cancel calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MoveImageDialog
        open
        onClose={onClose}
        onMove={vi.fn()}
        image={image}
        categories={categories}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders gracefully when image is null', () => {
    render(
      <MoveImageDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        image={null}
        categories={categories}
      />,
    )
    expect(screen.getByText('Move Image')).toBeInTheDocument()
  })
})
