import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FailedUploadsDialog from '../../src/components/FailedUploadsDialog'
import { listSourceImages, type ApiSourceImage } from '../../src/api'

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<typeof import('../../src/api')>('../../src/api')
  return { ...actual, listSourceImages: vi.fn() }
})

const mockList = vi.mocked(listSourceImages)

function makeFailed(overrides: Partial<ApiSourceImage> = {}): ApiSourceImage {
  return {
    id: 3,
    original_filename: 'broken.tiff',
    status: 'failed',
    progress: 20,
    error_message: 'Processing failed: unsupported format',
    status_message: null,
    name: null,
    category_id: null,
    copyright: null,
    note: null,
    active: true,
    image_id: null,
    file_size: 100,
    source_checksum: null,
    tile_settings_hash: null,
    tiles_generated_at: null,
    tile_cache_status: 'missing',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:05:00Z',
    ...overrides,
  }
}

describe('FailedUploadsDialog', () => {
  beforeEach(() => {
    mockList.mockReset()
    localStorage.clear()
  })

  it('lists each failed upload with its persisted reason', async () => {
    mockList.mockResolvedValue([makeFailed(), makeFailed({ id: 4, error_message: null })])
    render(<FailedUploadsDialog open onClose={vi.fn()} />)

    expect(await screen.findByText('Processing failed: unsupported format')).toBeInTheDocument()
    expect(screen.getAllByText('broken.tiff')).toHaveLength(2)
    expect(screen.getByText('Processing failed.')).toBeInTheDocument()
    expect(mockList).toHaveBeenCalledWith({ status: 'failed', limit: 200 })
  })

  it('shows an empty state when nothing failed', async () => {
    mockList.mockResolvedValue([])
    render(<FailedUploadsDialog open onClose={vi.fn()} />)

    expect(await screen.findByText('No failed uploads.')).toBeInTheDocument()
  })

  it('surfaces load errors', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    render(<FailedUploadsDialog open onClose={vi.fn()} />)

    expect(await screen.findByText('Failed to load failed uploads')).toBeInTheDocument()
  })

  it('dismisses a single row and remembers it across reopens', async () => {
    mockList.mockResolvedValue([makeFailed({ id: 3 }), makeFailed({ id: 4 })])
    const onDismiss = vi.fn()
    const { unmount } = render(<FailedUploadsDialog open onClose={vi.fn()} onDismiss={onDismiss} />)

    await screen.findAllByRole('button', { name: 'Dismiss' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])

    expect(onDismiss).toHaveBeenCalledWith(3)
    expect(screen.getByText('Dismissed')).toBeInTheDocument()
    unmount()

    render(<FailedUploadsDialog open onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Dismissed')).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1)
  })

  it('dismisses every remaining failure at once', async () => {
    mockList.mockResolvedValue([makeFailed({ id: 3 }), makeFailed({ id: 4 })])
    render(<FailedUploadsDialog open onClose={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss all' }))

    expect(screen.getAllByText('Dismissed')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).not.toBeInTheDocument()
  })

  it('does not fetch while closed and refetches on refresh', async () => {
    mockList.mockResolvedValue([])
    const { rerender } = render(<FailedUploadsDialog open={false} onClose={vi.fn()} />)
    expect(mockList).not.toHaveBeenCalled()

    rerender(<FailedUploadsDialog open onClose={vi.fn()} />)
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))
  })
})
