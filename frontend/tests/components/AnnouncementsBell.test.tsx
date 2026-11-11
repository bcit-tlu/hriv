import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AnnouncementsBell from '../../src/components/AnnouncementsBell'
import { makeAnnouncement } from '../announcementFixtures'

describe('AnnouncementsBell', () => {
  it('shows a dot badge while unseen posts exist and the newest unseen titles in the peek', () => {
    const onOpen = vi.fn()
    const onMarkSeen = vi.fn()
    render(
      <AnnouncementsBell
        announcements={[
          makeAnnouncement({ id: 1, title: 'Unseen one' }),
          makeAnnouncement({ id: 2, title: 'Already seen', seen: true }),
          makeAnnouncement({ id: 3, title: 'Unseen two', kind: 'celebration' }),
        ]}
        unseenCount={2}
        onOpenAnnouncements={onOpen}
        onMarkSeen={onMarkSeen}
      />,
    )
    const bell = screen.getByLabelText('Announcements, 2 unseen')
    expect(bell.querySelector('.MuiBadge-dot')).not.toBeNull()
    expect(bell).not.toHaveTextContent('2') // no number: the dot is enough
    fireEvent.click(bell)
    expect(screen.getByText('Unseen one')).toBeInTheDocument()
    expect(screen.getByText('Unseen two')).toBeInTheDocument()
    expect(screen.queryByText('Already seen')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Unseen two'))
    expect(onOpen).toHaveBeenCalledWith(3)
    expect(onMarkSeen).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
  })

  it('hides the dot when nothing is unseen', () => {
    render(<AnnouncementsBell announcements={[]} unseenCount={0} onOpenAnnouncements={() => {}} />)
    const badge = screen.getByLabelText('Announcements').querySelector('.MuiBadge-dot')
    expect(badge).toHaveClass('MuiBadge-invisible')
  })

  it('"See all" opens the page without a focused post and the empty state reads caught up', () => {
    const onOpen = vi.fn()
    render(<AnnouncementsBell announcements={[]} unseenCount={0} onOpenAnnouncements={onOpen} />)
    fireEvent.click(screen.getByLabelText('Announcements'))
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument()
    fireEvent.click(screen.getByText('See all'))
    expect(onOpen).toHaveBeenCalledWith(undefined)
  })

  it('caps the peek at five posts', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeAnnouncement({ id: i + 1, title: `Post ${i + 1}` }),
    )
    render(
      <AnnouncementsBell announcements={rows} unseenCount={7} onOpenAnnouncements={() => {}} />,
    )
    fireEvent.click(screen.getByLabelText('Announcements, 7 unseen'))
    expect(screen.getAllByText(/^Post \d$/)).toHaveLength(5)
  })
})
