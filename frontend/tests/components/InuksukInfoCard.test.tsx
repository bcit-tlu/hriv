import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import InuksukInfoCard from '../../src/components/InuksukInfoCard'
import { BOARD_FIXTURE, INUKSUK_FIXTURE } from '../../src/components/inuksukFixtures'

afterEach(() => vi.restoreAllMocks())
describe('InuksukInfoCard', () => {
  it('shows only visible Board names, description and favourite with explicit editing and close', async () => {
    vi.spyOn(api, 'fetchBoards').mockResolvedValue([
      BOARD_FIXTURE,
      { ...BOARD_FIXTURE, id: 2, name: 'Other Board' },
    ])
    const close = vi.fn(),
      edit = vi.fn()
    render(
      <InuksukInfoCard
        item={INUKSUK_FIXTURE}
        container={document.body}
        onClose={close}
        onEdit={edit}
      />,
    )
    expect(await screen.findByText(BOARD_FIXTURE.name)).toBeInTheDocument()
    expect(screen.queryByText('Other Board')).not.toBeInTheDocument()
    expect(screen.getByText(INUKSUK_FIXTURE.description!)).toBeInTheDocument()
    expect(screen.getByText('Favourite')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Rose window' }))
    expect(edit).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close Inuksuk information' }))
    expect(close).toHaveBeenCalledOnce()
  })
  it('handles empty content without offering edit to a viewer', async () => {
    vi.spyOn(api, 'fetchBoards').mockResolvedValue([])
    render(
      <InuksukInfoCard
        item={{
          ...INUKSUK_FIXTURE,
          description: null,
          favourite: false,
          permissions: { can_edit: false, can_delete: false },
        }}
        container={document.body}
        onClose={() => {}}
        onEdit={() => {}}
      />,
    )
    expect(await screen.findByText('No visible Boards')).toBeInTheDocument()
    expect(screen.getByText('Not a favourite')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })
  it('keeps the card usable when Board names cannot be loaded', async () => {
    vi.spyOn(api, 'fetchBoards').mockRejectedValue(new Error('offline'))
    render(
      <InuksukInfoCard
        item={INUKSUK_FIXTURE}
        container={document.body}
        onClose={() => {}}
        onEdit={() => {}}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load Board names.')
    expect(screen.getByRole('heading', { name: INUKSUK_FIXTURE.title })).toBeInTheDocument()
  })
})
