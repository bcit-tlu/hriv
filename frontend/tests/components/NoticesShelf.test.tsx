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

  it('shows up to three pinned posts as compact cards with reactions and open links', () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
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
    render(
      <NoticesShelf
        announcements={rows}
        onToggleReaction={onToggle}
        onOpenAnnouncements={onOpen}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Notices' })).toBeInTheDocument()
    expect(screen.getAllByTestId('announcement-card')).toHaveLength(3)
    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.queryByText('more body')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pinned 2' }))
    expect(onOpen).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByLabelText('heart reaction, 3'))
    expect(onToggle).toHaveBeenCalledWith(rows[2], 'heart')
    fireEvent.click(screen.getByText('All announcements'))
    expect(onOpen).toHaveBeenLastCalledWith()
  })
})
