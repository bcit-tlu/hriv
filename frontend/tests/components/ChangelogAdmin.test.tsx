import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ChangelogAdmin from '../../src/components/ChangelogAdmin'
import * as api from '../../src/api'

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/api')
  return {
    ...actual,
    fetchChangelogEntries: vi.fn(),
    createChangelogEntry: vi.fn(),
    updateChangelogEntry: vi.fn(),
    deleteChangelogEntry: vi.fn(),
  }
})

const mockFetchChangelogEntries = vi.mocked(api.fetchChangelogEntries)
const mockCreateChangelogEntry = vi.mocked(api.createChangelogEntry)
const mockUpdateChangelogEntry = vi.mocked(api.updateChangelogEntry)
const mockDeleteChangelogEntry = vi.mocked(api.deleteChangelogEntry)

const fixture: api.ApiChangelogEntry = {
  id: 1,
  title: 'v2.5',
  body: 'Released improvements',
  published_at: '2026-06-16T00:00:00Z',
  created_at: '2026-06-16T00:00:00Z',
  updated_at: '2026-06-16T00:00:00Z',
}

describe('ChangelogAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchChangelogEntries.mockResolvedValue([])
    mockCreateChangelogEntry.mockResolvedValue(fixture)
    mockUpdateChangelogEntry.mockResolvedValue(fixture)
  })

  it('renders empty state when there are no entries', async () => {
    render(<ChangelogAdmin />)

    await waitFor(() => expect(screen.getByText('No entries yet.')).toBeInTheDocument())
  })

  it('creates a new entry from the dialog', async () => {
    const onEntriesChanged = vi.fn()
    render(<ChangelogAdmin onEntriesChanged={onEntriesChanged} />)

    await waitFor(() => expect(mockFetchChangelogEntries).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'New Entry' }))
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'v2.5' },
    })
    fireEvent.change(screen.getByLabelText('Body (Markdown)'), {
      target: { value: 'Released improvements' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(mockCreateChangelogEntry).toHaveBeenCalledWith({
        title: 'v2.5',
        body: 'Released improvements',
      }),
    )
    expect(screen.getByText('v2.5')).toBeInTheDocument()
    expect(onEntriesChanged).toHaveBeenCalledTimes(1)
  })

  it('opens an existing row in republish mode', async () => {
    mockFetchChangelogEntries.mockResolvedValue([fixture])
    render(<ChangelogAdmin />)

    await waitFor(() => expect(screen.getByText('v2.5')).toBeInTheDocument())

    fireEvent.click(screen.getByText('v2.5'))
    expect(screen.getByRole('button', { name: 'Republish' })).toBeInTheDocument()
  })

  it('notifies when an entry is deleted', async () => {
    const onEntriesChanged = vi.fn()
    mockFetchChangelogEntries.mockResolvedValue([fixture])
    mockDeleteChangelogEntry.mockResolvedValue(undefined)
    render(<ChangelogAdmin onEntriesChanged={onEntriesChanged} />)

    await waitFor(() => expect(screen.getByText('v2.5')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))

    await waitFor(() => expect(mockDeleteChangelogEntry).toHaveBeenCalledWith(1))
    expect(onEntriesChanged).toHaveBeenCalledTimes(1)
  })

  it('renders entries newest-first even if the API returns them oldest-first', async () => {
    mockFetchChangelogEntries.mockResolvedValue([
      {
        ...fixture,
        id: 1,
        title: 'v2.4',
        published_at: '2026-06-15T00:00:00Z',
        created_at: '2026-06-15T00:00:00Z',
        updated_at: '2026-06-15T00:00:00Z',
      },
      {
        ...fixture,
        id: 2,
        title: 'v2.5',
        published_at: '2026-06-16T00:00:00Z',
        created_at: '2026-06-16T00:00:00Z',
        updated_at: '2026-06-16T00:00:00Z',
      },
    ])

    render(<ChangelogAdmin />)

    await waitFor(() => expect(screen.getByText('v2.5')).toBeInTheDocument())

    const rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('v2.5')
    expect(rows[2]).toHaveTextContent('v2.4')
  })

  it('shows the new chip only for entries published within the last 7 days', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-20T00:00:00Z').getTime())
    mockFetchChangelogEntries.mockResolvedValue([
      {
        ...fixture,
        id: 1,
        title: 'Recent entry',
        published_at: '2026-06-16T00:00:00Z',
        created_at: '2026-06-16T00:00:00Z',
        updated_at: '2026-06-16T00:00:00Z',
      },
      {
        ...fixture,
        id: 2,
        title: 'Older entry',
        published_at: '2026-06-10T00:00:00Z',
        created_at: '2026-06-10T00:00:00Z',
        updated_at: '2026-06-10T00:00:00Z',
      },
    ])

    render(<ChangelogAdmin />)

    expect(await screen.findByText('Recent entry')).toBeInTheDocument()
    expect(screen.getByText('new')).toBeInTheDocument()
    expect(screen.getByText('Older entry').closest('tr')).not.toHaveTextContent('new')
  })
})
