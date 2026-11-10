import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AnnouncementCard from '../../src/components/AnnouncementCard'
import { announcementTimeLabel } from '../../src/announcementUtils'
import { ANNOUNCEMENT_REACTIONS } from '../../src/announcementKinds'
import { makeAnnouncement } from '../announcementFixtures'

describe('AnnouncementCard', () => {
  it('renders kind icon, title, author, audience chips and the Markdown body', () => {
    render(
      <AnnouncementCard
        announcement={makeAnnouncement({ kind: 'event', program_names: ['Histotech'] })}
      />,
    )
    expect(screen.getByLabelText('Event')).toBeInTheDocument()
    expect(screen.getByText('Lab 3 moved to Thursday')).toBeInTheDocument()
    expect(screen.getByText('Dr. Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Histotech')).toBeInTheDocument()
    expect(screen.getByText('Histology 2026')).toBeInTheDocument()
    expect(screen.getByText('slides').tagName).toBe('STRONG')
  })

  it('falls back to "Site" when the author is gone and shows Everyone for broadcast posts', () => {
    render(
      <AnnouncementCard
        announcement={makeAnnouncement({ author_id: null, author_name: '', audience: 'everyone' })}
      />,
    )
    expect(screen.getByText('Site')).toBeInTheDocument()
    expect(screen.getByText('Everyone')).toBeInTheDocument()
  })

  it('shows seen counts only to staff viewers when the API supplies them', () => {
    const a = makeAnnouncement({ seen_count: 3, audience_size: 12 })
    const { rerender } = render(<AnnouncementCard announcement={a} viewerIsStaff />)
    expect(screen.getByText(/Seen by 3 of 12/)).toBeInTheDocument()
    rerender(<AnnouncementCard announcement={a} />)
    expect(screen.queryByText(/Seen by/)).not.toBeInTheDocument()
    rerender(<AnnouncementCard announcement={makeAnnouncement()} viewerIsStaff />)
    expect(screen.queryByText(/Seen by/)).not.toBeInTheDocument()
  })

  it('renders reaction pills and lets the viewer toggle them', () => {
    const onToggle = vi.fn()
    const a = makeAnnouncement({ reactions: { heart: 2 }, my_reactions: ['heart'] })
    render(<AnnouncementCard announcement={a} onToggleReaction={onToggle} />)
    fireEvent.click(screen.getByLabelText('heart reaction, 2'))
    expect(onToggle).toHaveBeenCalledWith(a, 'heart')
    fireEvent.click(screen.getByLabelText('Add reaction'))
    fireEvent.click(screen.getByLabelText(ANNOUNCEMENT_REACTIONS[5].label))
    expect(onToggle).toHaveBeenLastCalledWith(a, 'rocket')
  })

  it('shows status chips and edit/duplicate/delete only for editable rows in manage mode', () => {
    const onEdit = vi.fn()
    const onDuplicate = vi.fn()
    const onDelete = vi.fn()
    const a = makeAnnouncement({
      status: 'scheduled',
      can_edit: true,
      publish_at: '2030-01-01T10:00:00+00:00',
    })
    const { rerender } = render(
      <AnnouncementCard
        announcement={a}
        manage
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />,
    )
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(`Actions for ${a.title}`))
    fireEvent.click(screen.getByText('Edit'))
    expect(onEdit).toHaveBeenCalledWith(a)
    fireEvent.click(screen.getByLabelText(`Actions for ${a.title}`))
    fireEvent.click(screen.getByText('Duplicate'))
    expect(onDuplicate).toHaveBeenCalledWith(a)
    fireEvent.click(screen.getByLabelText(`Actions for ${a.title}`))
    fireEvent.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledWith(a)

    rerender(
      <AnnouncementCard
        announcement={makeAnnouncement({ can_edit: false, author_name: 'Co-instructor' })}
        manage
        onEdit={onEdit}
      />,
    )
    expect(screen.queryByLabelText(/Actions for/)).not.toBeInTheDocument()
    expect(screen.getByText(/Co-instructor \(co-managed\)/)).toBeInTheDocument()
  })

  it('labels scheduled and expired posts with their times', () => {
    const now = new Date('2026-03-10T12:00:00Z')
    expect(
      announcementTimeLabel(
        makeAnnouncement({ status: 'scheduled', publish_at: '2026-03-12T12:00:00Z' }),
        now,
      ),
    ).toMatch(/^Scheduled/)
    expect(
      announcementTimeLabel(
        makeAnnouncement({ status: 'expired', expires_at: '2026-03-09T12:00:00Z' }),
        now,
      ),
    ).toMatch(/^Expired/)
    expect(
      announcementTimeLabel(makeAnnouncement({ status: 'draft', publish_at: null }), now),
    ).toBe('Draft')
  })
})
