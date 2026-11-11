import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AnnouncementReactions from '../../src/components/AnnouncementReactions'
import { ANNOUNCEMENT_REACTIONS } from '../../src/announcementKinds'
import { makeAnnouncement } from '../announcementFixtures'

describe('AnnouncementReactions', () => {
  it("renders pills with counts, marks the viewer's own and toggles through the handler", () => {
    const onToggle = vi.fn()
    const a = makeAnnouncement({ reactions: { heart: 2, hooray: 1 }, my_reactions: ['heart'] })
    render(<AnnouncementReactions announcement={a} onToggleReaction={onToggle} />)
    const heart = screen.getByRole('button', { name: 'heart reaction, 2' })
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'hooray reaction, 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    fireEvent.click(heart)
    expect(onToggle).toHaveBeenCalledWith(a, 'heart')
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(ANNOUNCEMENT_REACTIONS.length)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rocket' }))
    expect(onToggle).toHaveBeenLastCalledWith(a, 'rocket')
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
