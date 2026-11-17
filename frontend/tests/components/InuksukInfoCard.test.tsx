import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import InuksukInfoCard from '../../src/components/InuksukInfoCard'
import { BOARD_FIXTURE, INUKSUK_FIXTURE } from '../../src/components/inuksukFixtures'

vi.mock('../../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchBoards: vi.fn(),
  fetchBoard: vi.fn(),
  fetchInuksuk: vi.fn(),
  updateInuksuk: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())
describe('InuksukInfoCard', () => {
  it('edits inside the card, keeps outside/menu presses from discarding edits and saves its version', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([BOARD_FIXTURE])
    vi.mocked(api.fetchBoard).mockResolvedValue(BOARD_FIXTURE)
    const update = vi.mocked(api.updateInuksuk).mockResolvedValue(INUKSUK_FIXTURE)
    const close = vi.fn(),
      cancel = vi.fn(),
      changed = vi.fn()
    render(
      <InuksukInfoCard
        item={INUKSUK_FIXTURE}
        container={document.body}
        editing
        onClose={close}
        onEdit={() => {}}
        onCancelEdit={cancel}
        onChanged={changed}
      />,
    )
    const card = screen.getByRole('region', { name: 'Inuksuk information' })
    expect(within(card).getByRole('form', { name: 'Edit Inuksuk' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'My edit' },
    })
    fireEvent.pointerDown(document.body)
    expect(close).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Boards' }))
    const option = await screen.findByRole('option', { name: BOARD_FIXTURE.name })
    expect(option).toBeVisible()
    fireEvent.pointerDown(option)
    expect(close).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Boards' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ title: 'My edit', version: 3 }),
      ),
    )
    expect(changed).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('shows visible Board names, description and favourite without an X; outside pointer and Escape close', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([
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
    const star = screen.getByRole('button', { name: 'Favourite' })
    expect(star).toBeInTheDocument()
    const heading = screen.getByRole('heading', { name: INUKSUK_FIXTURE.title })
    expect(heading.previousElementSibling).toHaveAttribute('data-testid', 'CompassCalibrationIcon')
    expect(heading.nextElementSibling).toContainElement(
      screen.getByRole('button', { name: 'Edit Rose window' }),
    )
    expect(screen.queryByRole('button', { name: 'Close Inuksuk information' })).toBeNull()
    expect(screen.queryByText('Favourite', { exact: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Rose window' }))
    expect(edit).toHaveBeenCalledOnce()
    fireEvent.pointerDown(screen.getByRole('heading', { name: INUKSUK_FIXTURE.title }))
    expect(close).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(close).toHaveBeenCalledOnce()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(2)
  })
  it('handles empty content without offering edit to a viewer', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([])
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
    expect(screen.queryByText('Not a favourite')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Not favourited' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Favourite' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })
  it('persists view-mode favourite toggles and edits with the latest returned version', async () => {
    vi.mocked(api.fetchBoards).mockResolvedValue([])
    vi.mocked(api.updateInuksuk)
      .mockResolvedValueOnce({ ...INUKSUK_FIXTURE, version: 4, favourite: false })
      .mockResolvedValueOnce({ ...INUKSUK_FIXTURE, version: 5, favourite: true })
    const changed = vi.fn(),
      edit = vi.fn()
    render(
      <InuksukInfoCard
        item={INUKSUK_FIXTURE}
        container={document.body}
        onClose={vi.fn()}
        onEdit={edit}
        onChanged={changed}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Favourite' })).toBeEnabled())
    expect(api.updateInuksuk).toHaveBeenLastCalledWith(7, { version: 3, favourite: false })
    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Favourite' })).toBeEnabled())
    expect(api.updateInuksuk).toHaveBeenLastCalledWith(7, { version: 4, favourite: true })
    expect(changed).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Rose window' }))
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ version: 5, favourite: true }))
  })
  it.each([403, 409])(
    'retains favourite state after an API %s and requires reload for conflicts',
    async (status) => {
      vi.mocked(api.fetchBoards).mockResolvedValue([])
      vi.mocked(api.updateInuksuk).mockRejectedValueOnce(new api.ApiError(status, 'Denied'))
      vi.mocked(api.fetchInuksuk).mockResolvedValue({ ...INUKSUK_FIXTURE, version: 6 })
      render(
        <InuksukInfoCard
          item={INUKSUK_FIXTURE}
          container={document.body}
          onClose={vi.fn()}
          onEdit={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Favourite' }))
      expect(await screen.findByRole('alert')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      if (status === 409) {
        expect(screen.getByRole('button', { name: 'Favourite' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Reload current' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Favourite' })).toBeEnabled())
        expect(api.fetchInuksuk).toHaveBeenCalledWith(7)
      }
    },
  )
  it('keeps the card usable when Board names cannot be loaded', async () => {
    vi.mocked(api.fetchBoards).mockRejectedValue(new Error('offline'))
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
