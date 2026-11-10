import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as api from '../../src/api'
import AnnouncementsPage from '../../src/components/AnnouncementsPage'
import type { UseAnnouncementsResult } from '../../src/useAnnouncements'
import type { User } from '../../src/types'
import { makeAnnouncement } from '../announcementFixtures'

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/api')
  return {
    ...actual,
    fetchAnnouncements: vi.fn(),
    fetchPrograms: vi.fn(),
    fetchGroups: vi.fn(),
    deleteAnnouncement: vi.fn(),
    createAnnouncement: vi.fn(),
  }
})

const mockFetch = vi.mocked(api.fetchAnnouncements)
const mockPrograms = vi.mocked(api.fetchPrograms)
const mockGroups = vi.mocked(api.fetchGroups)
const mockDelete = vi.mocked(api.deleteAnnouncement)
const mockCreate = vi.mocked(api.createAnnouncement)

const instructor: User = {
  id: 7,
  name: 'Ada',
  email: 'ada@example.ca',
  role: 'instructor',
  active: true,
  program_ids: [1],
  program_names: ['Histotech'],
  group_ids: [],
  group_names: [],
}
const student: User = { ...instructor, id: 20, role: 'student', program_ids: [], program_names: [] }

function makeFeed(overrides: Partial<UseAnnouncementsResult> = {}): UseAnnouncementsResult {
  return {
    announcements: [],
    unseenCount: 0,
    loading: false,
    error: null,
    reload: vi.fn(async () => {}),
    markSeen: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
    toggleReaction: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('AnnouncementsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch.mockReset().mockResolvedValue([])
    mockPrograms.mockReset().mockResolvedValue([{ id: 1, name: 'Histotech' }] as api.ApiProgram[])
    mockGroups.mockReset().mockResolvedValue([
      { id: 3, name: 'Histology 2026', instructor_ids: [7], member_ids: [] },
      { id: 4, name: 'Other', instructor_ids: [8], member_ids: [] },
    ] as unknown as api.ApiGroup[])
    mockDelete.mockReset().mockResolvedValue(undefined)
    mockCreate.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows the loading, error and empty states of the inbox', () => {
    const { rerender } = render(
      <AnnouncementsPage
        currentUser={student}
        feed={makeFeed({ loading: true })}
        canCompose={false}
      />,
    )
    expect(screen.getByLabelText('Loading announcements')).toBeInTheDocument()
    const reload = vi.fn(async () => {})
    rerender(
      <AnnouncementsPage
        currentUser={student}
        feed={makeFeed({ error: 'Could not load announcements', reload })}
        canCompose={false}
      />,
    )
    fireEvent.click(screen.getByText('Retry'))
    expect(reload).toHaveBeenCalled()
    rerender(<AnnouncementsPage currentUser={student} feed={makeFeed()} canCompose={false} />)
    expect(screen.getByText('No announcements yet.')).toBeInTheDocument()
  })

  it('students get the Inbox only, with no tabs or compose button, and posts are marked seen once', () => {
    const markSeen = vi.fn()
    const rows = [makeAnnouncement({ id: 1 }), makeAnnouncement({ id: 2, seen: true })]
    render(
      <AnnouncementsPage
        currentUser={student}
        feed={makeFeed({ announcements: rows, markSeen })}
        canCompose={false}
      />,
    )
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByText('New announcement')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('announcement-card')).toHaveLength(2)
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(markSeen).toHaveBeenCalledTimes(1)
    expect(markSeen).toHaveBeenCalledWith(rows[0])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('Mine loads the author scope, filters by status and shows co-managed rows read-only', async () => {
    mockFetch.mockResolvedValue([
      makeAnnouncement({ id: 1, title: 'Live one', status: 'live', can_edit: true }),
      makeAnnouncement({
        id: 2,
        title: 'Draft one',
        status: 'draft',
        publish_at: null,
        can_edit: true,
      }),
      makeAnnouncement({
        id: 3,
        title: 'Peer post',
        status: 'live',
        can_edit: false,
        author_name: 'Grace',
      }),
    ])
    render(<AnnouncementsPage currentUser={instructor} feed={makeFeed()} canCompose />)
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('mine'))
    await screen.findByText('Live one')
    expect(screen.getByText('Peer post')).toBeInTheDocument()
    expect(screen.getByText(/Grace \(co-managed\)/)).toBeInTheDocument()
    expect(screen.getAllByLabelText(/Actions for/)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Draft' }))
    expect(screen.getByText('Draft one')).toBeInTheDocument()
    expect(screen.queryByText('Live one')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expired' }))
    expect(screen.getByText('No expired announcements.')).toBeInTheDocument()
  })

  it('delete asks for confirmation, then removes the row from Mine and the feed', async () => {
    const remove = vi.fn()
    mockFetch.mockResolvedValue([makeAnnouncement({ id: 9, title: 'Doomed', can_edit: true })])
    render(<AnnouncementsPage currentUser={instructor} feed={makeFeed({ remove })} canCompose />)
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }))
    await screen.findByText('Doomed')
    fireEvent.click(screen.getByLabelText('Actions for Doomed'))
    fireEvent.click(screen.getByText('Delete'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete announcement?')).toBeInTheDocument()
    expect(mockDelete).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(9))
    await waitFor(() => expect(screen.queryByText('Doomed')).not.toBeInTheDocument())
    expect(remove).toHaveBeenCalledWith(9)
  })

  it('duplicate opens the composer prefilled with "(copy)" and only the groups the instructor manages', async () => {
    mockFetch.mockResolvedValue([makeAnnouncement({ id: 2, title: 'Original', can_edit: true })])
    render(<AnnouncementsPage currentUser={instructor} feed={makeFeed()} canCompose />)
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }))
    await screen.findByText('Original')
    await waitFor(() => expect(mockGroups).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('Actions for Original'))
    fireEvent.click(screen.getByText('Duplicate'))
    expect(screen.getByLabelText(/Title/)).toHaveValue('Original (copy)')
    fireEvent.mouseDown(screen.getByLabelText('To'))
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).queryByText('Other')).not.toBeInTheDocument()
    expect(within(listbox).getByText('Histotech')).toBeInTheDocument()
    expect(within(listbox).queryByText('Everyone')).not.toBeInTheDocument()
  })

  it('"Post to group" opens the composer with the group pre-selected and saves into Mine + reloads the feed', async () => {
    const saved = makeAnnouncement({ id: 50, title: 'Hello cohort', can_edit: true })
    mockCreate.mockResolvedValue(saved)
    const reload = vi.fn(async () => {})
    const consumed = vi.fn()
    render(
      <AnnouncementsPage
        currentUser={instructor}
        feed={makeFeed({ reload })}
        canCompose
        composeGroupId={3}
        onComposeGroupConsumed={consumed}
      />,
    )
    await waitFor(() => expect(mockGroups).toHaveBeenCalled())
    await screen.findByText('Histology 2026', { selector: '.MuiChip-label' })
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Hello cohort' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ group_ids: [3], audience: 'targeted' })
    expect(reload).toHaveBeenCalled()
    expect(consumed).toHaveBeenCalled()
  })

  it('highlights and scrolls to a deep-linked post', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(
      <AnnouncementsPage
        currentUser={student}
        feed={makeFeed({ announcements: [makeAnnouncement({ id: 77 })] })}
        canCompose={false}
        focusId={77}
      />,
    )
    expect(scroll).toHaveBeenCalled()
    expect(document.getElementById('announcement-77')).toBeInTheDocument()
  })
})
