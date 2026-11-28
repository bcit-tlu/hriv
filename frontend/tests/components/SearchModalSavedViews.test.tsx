import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as api from '../../src/api'
import SearchModal from '../../src/components/SearchModal'
import { BOARDS_FIXTURES } from '../../src/components/boardsFixtures'
import { MARKER_FIXTURE } from '../../src/components/markerFixtures'

vi.mock('../../src/api', async (original) => ({
  ...(await original<typeof api>()),
  fetchBoards: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchBoard: vi.fn(),
  fetchImage: vi.fn(),
}))
const board = { ...BOARDS_FIXTURES[0], name: 'Rose studies', description: 'Tracery inspiration' }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.fetchBoards).mockResolvedValue([board])
  vi.mocked(api.fetchMarkers).mockResolvedValue([MARKER_FIXTURE])
  vi.mocked(api.fetchBoard).mockResolvedValue(board)
  vi.mocked(api.fetchImage).mockResolvedValue({
    id: 42,
    name: 'Architecture',
    thumb: '',
    tile_sources: '/tiles/42/image.dzi',
    category_id: null,
    copyright: null,
    description: null,
    active: true,
    sort_order: 0,
    metadata_extra: null,
    version: 1,
    width: 100,
    height: 100,
    file_size: 100,
    created_at: MARKER_FIXTURE.created_at,
    updated_at: MARKER_FIXTURE.updated_at,
  })
})
function setup(overrides: Partial<React.ComponentProps<typeof SearchModal>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    categories: [],
    uncategorizedImages: [],
    programs: [],
    users: [],
    excludeHidden: true,
    suppressExtendedResults: true,
    markersEnabled: true,
    onSelectCategory: vi.fn(),
    onSelectImage: vi.fn(),
    onSelectProgram: vi.fn(),
    onSelectUser: vi.fn(),
    onSelectBoard: vi.fn(),
    onSelectMarker: vi.fn(),
    onAddImagesToCollection: vi.fn(),
    ...overrides,
  }
  const view = render(<SearchModal {...props} />)
  return { ...view, props }
}
function search(text = 'Rose') {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
}
function result(name: string) {
  return screen
    .getAllByTestId('search-result-action-area')
    .find((row) => within(row).queryByText(name))!
}

it('uses server-filtered title and description results, chips, and saved-view navigation', async () => {
  const { props } = setup()
  search()
  await screen.findByText('Rose studies')
  expect(api.fetchBoards).toHaveBeenCalledWith(
    expect.objectContaining({ q: 'rose' }),
    expect.anything(),
  )
  expect(screen.getByText('Boards')).toBeVisible()
  expect(screen.getByText('Markers')).toBeVisible()
  fireEvent.click(result('Rose studies'))
  expect(props.onSelectBoard).toHaveBeenCalledWith(board.id)
  fireEvent.click(result('Rose window'))
  expect(props.onSelectMarker).toHaveBeenCalledWith(MARKER_FIXTURE)
  search('Tracery')
  await waitFor(() => expect(screen.getByText('Rose studies')).toBeVisible())
  fireEvent.click(screen.getByText('Boards'))
  expect(screen.queryByText('Rose window')).not.toBeInTheDocument()
})

it('does not query or expose saved-view kinds with the flag off', async () => {
  setup({ markersEnabled: false })
  search()
  expect(screen.queryByText('Boards')).not.toBeInTheDocument()
  expect(api.fetchBoards).not.toHaveBeenCalled()
  expect(api.fetchMarkers).not.toHaveBeenCalled()
})

it.each(['board', 'marker'] as const)(
  'stages %s saved views rather than navigating in collection-picker mode',
  async (kind) => {
    const { props } = setup({ initialSelectMode: true })
    search()
    await screen.findByText('Rose studies')
    fireEvent.click(result(kind === 'board' ? 'Rose studies' : 'Rose window'))
    await waitFor(() => expect(props.onAddImagesToCollection).toHaveBeenCalled())
    const members = props.onAddImagesToCollection.mock.calls[0][0]
    expect(members).toHaveLength(kind === 'board' ? 6 : 1)
    expect(members[0]).toEqual(
      expect.objectContaining({
        id: 42,
        markerId: 7,
        slot: expect.objectContaining({
          id: -7,
          label: 'Rose window',
          viewport_state: { x: 0.46, y: 0.29, zoom: 2.5, rotation: 0 },
        }),
      }),
    )
    expect(props.onSelectBoard).not.toHaveBeenCalled()
    expect(props.onSelectMarker).not.toHaveBeenCalled()
  },
)

it('keeps empty and failed searches empty and reports failures', async () => {
  vi.mocked(api.fetchBoards).mockResolvedValue([])
  vi.mocked(api.fetchMarkers).mockResolvedValue([])
  setup()
  search()
  await waitFor(() => expect(api.fetchMarkers).toHaveBeenCalled())
  expect(screen.queryByText('Rose window')).not.toBeInTheDocument()
  vi.mocked(api.fetchBoards).mockRejectedValue(new Error('Search unavailable'))
  search('tracery')
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to search saved views.')
})

it('does not close or stage a Board that no longer has visible members', async () => {
  vi.mocked(api.fetchBoard).mockResolvedValue({ ...board, markers: [] })
  const { props, rerender } = setup({ initialSelectMode: true })
  search()
  await screen.findByText('Rose studies')
  fireEvent.click(result('Rose studies'))
  expect(await screen.findByRole('alert')).toHaveTextContent('no visible saved views')
  expect(props.onAddImagesToCollection).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
  rerender(<SearchModal {...props} open={false} />)
  rerender(<SearchModal {...props} open />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps the draft unchanged when a source image cannot be loaded', async () => {
  vi.mocked(api.fetchImage).mockRejectedValue(new Error('Image no longer available'))
  const { props } = setup({ initialSelectMode: true })
  search()
  await screen.findByText('Rose window')
  fireEvent.click(result('Rose window'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to stage saved views.')
  expect(props.onAddImagesToCollection).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
})
