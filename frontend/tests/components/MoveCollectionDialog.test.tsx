import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoveCollectionDialog from '../../src/components/MoveCollectionDialog'
import { makeCollectionSummary } from '../helpers/fixtures'

// Mock CategoryPickerSelect since it is a complex component tested separately
vi.mock('../../src/components/CategoryPickerSelect', () => ({
  default: ({
    value,
    onChange,
    label,
    rootLabel = 'None (root level)',
  }: {
    value: number | null
    onChange: (v: number | null) => void
    label: string
    rootLabel?: string
  }) => (
    <select
      data-testid="category-picker"
      data-value={value ?? ''}
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{rootLabel}</option>
      <option value="10">Category 10</option>
    </select>
  ),
}))

const collection = makeCollectionSummary({ id: 7, name: 'Epithelia', categoryId: 1 })

describe('MoveCollectionDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the title and collection name', () => {
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        collection={collection}
        categories={[]}
      />,
    )
    expect(screen.getByText('Move Collection')).toBeInTheDocument()
    expect(
      screen.getByText(
        "File “Epithelia” into a Browse category. Collections that aren't filed don't appear on Browse.",
      ),
    ).toBeInTheDocument()
  })

  it('preselects the collection current category on open', () => {
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        collection={collection}
        categories={[]}
      />,
    )
    expect(screen.getByTestId('category-picker')).toHaveAttribute('data-value', '1')
  })

  it('calls onMove with the selected destination', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn()
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={onMove}
        collection={collection}
        categories={[]}
      />,
    )

    await user.selectOptions(screen.getByTestId('category-picker'), '10')
    await user.click(screen.getByRole('button', { name: 'Move' }))

    expect(onMove).toHaveBeenCalledWith(10)
  })

  it('sends null when the unfiled destination is chosen', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn()
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={onMove}
        collection={collection}
        categories={[]}
      />,
    )

    await user.selectOptions(screen.getByTestId('category-picker'), '')
    await user.click(screen.getByRole('button', { name: 'Move' }))

    expect(onMove).toHaveBeenCalledWith(null)
  })

  it('labels the null destination Not on Browse', () => {
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        collection={collection}
        categories={[]}
      />,
    )

    expect(screen.getByRole('option', { name: 'Not on Browse' })).toBeInTheDocument()
  })

  it('warns when filing a private collection and hides the warning when unfiled', async () => {
    const user = userEvent.setup()
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        collection={{ ...collection, visibility: 'private' }}
        categories={[]}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This collection is private. Students will not be able to see the images in this collection.',
    )

    await user.selectOptions(screen.getByTestId('category-picker'), '')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not warn when filing a public collection', () => {
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        collection={{ ...collection, visibility: 'public' }}
        categories={[]}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('cancel calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MoveCollectionDialog
        open
        onClose={onClose}
        onMove={vi.fn()}
        collection={collection}
        categories={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables actions while a move is in flight', async () => {
    const user = userEvent.setup()
    let resolveMove: () => void = () => {}
    const onMove = vi.fn(() => new Promise<void>((r) => (resolveMove = r)))
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={onMove}
        collection={collection}
        categories={[]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Move' }))
    expect(screen.getByRole('button', { name: 'Moving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()

    await act(async () => resolveMove())
    expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled()
  })

  it('renders no name sentence when collection is null', () => {
    render(
      <MoveCollectionDialog
        open
        onClose={vi.fn()}
        onMove={vi.fn()}
        collection={null}
        categories={[]}
      />,
    )
    expect(screen.getByText('Move Collection')).toBeInTheDocument()
    expect(screen.queryByText(/File “/)).not.toBeInTheDocument()
  })
})
