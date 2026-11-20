import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import NoticesShelf from '../../src/components/NoticesShelf'
import { makeAnnouncement } from '../announcementFixtures'

describe('NoticesShelf', () => {
  it('renders nothing when there are no pinned live posts', () => {
    const { container } = render(
      <NoticesShelf
        announcements={[makeAnnouncement({ pinned: false })]}
        onOpenAnnouncements={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows up to three pinned posts as compact cards (no reactions) with open links', () => {
    const onOpen = vi.fn()
    const rows = [1, 2, 3, 4].map((id) =>
      makeAnnouncement({
        id,
        pinned: true,
        title: `Pinned ${id}`,
        message: `**Line ${id}**\nmore body`,
        reactions: { heart: id },
        my_reactions: [],
      }),
    )
    render(<NoticesShelf announcements={rows} onOpenAnnouncements={onOpen} />)
    expect(screen.getByRole('heading', { name: 'Notices' })).toBeInTheDocument()
    expect(screen.getAllByTestId('announcement-card')).toHaveLength(3)
    // Full Markdown body: pinned posts are never truncated to their first line.
    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getAllByText(/more body/)).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Pinned 2' }))
    expect(onOpen).toHaveBeenCalledWith(2)
    expect(screen.queryByLabelText('heart reaction, 3')).toBeNull()
    fireEvent.click(screen.getByText('All announcements'))
    expect(onOpen).toHaveBeenLastCalledWith()
  })

  it('collapses seen posts to their title; Expand / Collapse toggles the body', () => {
    const seen = makeAnnouncement({
      id: 1,
      pinned: true,
      title: 'Old news',
      message: 'Seen body',
      seen: true,
    })
    const onMarkSeen = vi.fn()
    render(<NoticesShelf announcements={[seen]} onMarkSeen={onMarkSeen} />)
    expect(screen.queryByText('Seen body')).toBeNull()
    const more = screen.getByRole('button', { name: 'Expand' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(screen.getByText('Seen body')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('Seen body')).toBeNull()
    expect(onMarkSeen).not.toHaveBeenCalled()
  })

  it('marks an unseen post seen when the reader collapses it', () => {
    const fresh = makeAnnouncement({ id: 2, pinned: true, title: 'Fresh', message: 'Fresh body' })
    const onMarkSeen = vi.fn()
    render(<NoticesShelf announcements={[fresh]} onMarkSeen={onMarkSeen} />)
    expect(screen.getByText('Fresh body')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(onMarkSeen).toHaveBeenCalledWith(fresh)
    expect(screen.queryByText('Fresh body')).toBeNull()
  })

  it('re-expands a collapsed post when it is re-notified', () => {
    const post = makeAnnouncement({
      id: 3,
      pinned: true,
      message: 'Body',
      notified_at: '2026-01-01T00:00:00Z',
    })
    const { rerender } = render(<NoticesShelf announcements={[post]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByText('Body')).toBeNull()
    rerender(
      <NoticesShelf
        announcements={[{ ...post, seen: false, notified_at: '2026-02-01T00:00:00Z' }]}
      />,
    )
    expect(screen.getByText('Body')).toBeInTheDocument()
  })
})
