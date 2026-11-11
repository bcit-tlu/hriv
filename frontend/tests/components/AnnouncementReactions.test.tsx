import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AnnouncementReactions from '../../src/components/AnnouncementReactions'
import { ANNOUNCEMENT_REACTIONS } from '../../src/announcementKinds'
import { makeAnnouncement } from '../announcementFixtures'

describe('AnnouncementReactions', () => {
  it('offers the picker until the viewer reacts, then only their own pill is pressable', () => {
    const onToggle = vi.fn()
    const none = makeAnnouncement({ reactions: { heart: 2 }, my_reactions: [] })
    const { rerender } = render(
      <AnnouncementReactions announcement={none} onToggleReaction={onToggle} />,
    )
    // Other readers' pills are counts only.
    expect(screen.getByLabelText('heart reaction, 2')).not.toHaveClass('MuiChip-clickable')
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(ANNOUNCEMENT_REACTIONS.length)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rocket' }))
    expect(onToggle).toHaveBeenCalledWith(none, 'rocket')

    const mine = makeAnnouncement({ reactions: { heart: 2, rocket: 1 }, my_reactions: ['rocket'] })
    rerender(<AnnouncementReactions announcement={mine} onToggleReaction={onToggle} />)
    expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull()
    const own = screen.getByRole('button', { name: /rocket reaction, 1, yours/ })
    expect(own).toHaveAttribute('aria-pressed', 'true')
    expect(own).toHaveClass('MuiChip-outlined') // no filled background
    fireEvent.click(own)
    expect(onToggle).toHaveBeenLastCalledWith(mine, 'rocket')
  })

  it('is read-only without a handler or when the post is not live', () => {
    const a = makeAnnouncement({ reactions: { clap: 3 } })
    const { rerender } = render(<AnnouncementReactions announcement={a} />)
    expect(screen.getByLabelText('clap reaction, 3')).not.toHaveAttribute('aria-pressed')
    expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull()
    rerender(
      <AnnouncementReactions
        announcement={makeAnnouncement({ status: 'expired', reactions: { clap: 3 } })}
        onToggleReaction={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull()
  })

  it('renders nothing when there are no reactions and the viewer cannot react', () => {
    const { container } = render(<AnnouncementReactions announcement={makeAnnouncement()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
