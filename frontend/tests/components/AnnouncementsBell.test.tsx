import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AnnouncementsBell from '../../src/components/AnnouncementsBell'
import { makeAnnouncement } from '../announcementFixtures'

describe('AnnouncementsBell', () => {
  it('shows the unseen count on the badge and the newest unseen titles in the peek', () => {
    const onOpen = vi.fn()
    render(
      <AnnouncementsBell
        announcements={[
          makeAnnouncement({ id: 1, title: 'Unseen one' }),
          makeAnnouncement({ id: 2, title: 'Already seen', seen: true }),
          makeAnnouncement({ id: 3, title: 'Unseen two', kind: 'celebration' }),
        ]}
        unseenCount={2}
        onOpenAnnouncements={onOpen}
      />,
    )
    const bell = screen.getByLabelText('Announcements, 2 unseen')
    expect(bell).toHaveTextContent('2')
    fireEvent.click(bell)
    expect(screen.getByText('Unseen one')).toBeInTheDocument()
    expect(screen.getByText('Unseen two')).toBeInTheDocument()
    expect(screen.queryByText('Already seen')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Unseen two'))
    expect(onOpen).toHaveBeenCalledWith(3)
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
