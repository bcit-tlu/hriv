import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../src/authContextValue'
import type { AuthContextValue } from '../../src/authContextValue'
import AddToCollectionDialog, {
  CAP_REACHED_TOOLTIP,
  type AddToCollectionDialogProps,
} from '../../src/components/AddToCollectionDialog'
import type { Role } from '../../src/types'
import { makeCollectionSummary } from '../helpers/fixtures'

function makeAuth(role: Role, id = 7) {
  return {
    currentUser: {
      id,
      name: 'Test User',
      email: 'user@example.com',
      role,
      active: true,
      program_ids: [],
      program_names: [],
      group_ids: [],
      group_names: [],
    },
    users: [],
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    addUser: vi.fn(),
    deleteUser: vi.fn(),
    refreshUsers: vi.fn(),
    canManageUsers: role === 'admin',
    canEditContent: role === 'admin' || role === 'instructor',
    canViewPeople: role !== 'student',
    oidcError: null,
    clearOidcError: vi.fn(),
  } as unknown as AuthContextValue
}

const MINE = makeCollectionSummary({ id: 1, name: 'Skull comparison', imageCount: 2 })
const PROGRAM_OWNED = makeCollectionSummary({
  id: 2,
  name: 'Chest positioning',
  type: 'sequence',
  owners: [{ kind: 'program', programId: 1, name: 'Radiography' }],
  imageCount: 9,
})
const SOMEONE_ELSES = makeCollectionSummary({
  id: 3,
  name: 'Orphaned pairs',
  owners: [],
  imageCount: 0,
})

function renderDialog(
  overrides: Partial<AddToCollectionDialogProps> = {},
  auth: AuthContextValue = makeAuth('instructor'),
) {
  const props: AddToCollectionDialogProps = {
    open: true,
    onClose: vi.fn(),
    imageIds: [42],
    collections: [MINE, PROGRAM_OWNED, SOMEONE_ELSES],
    loading: false,
    error: null,
    onAdd: vi.fn(async () => true),
    onCreate: vi.fn(async () => undefined),
    ...overrides,
  }
  const view = render(
    <AuthContext.Provider value={auth}>
      <AddToCollectionDialog {...props} />
    </AuthContext.Provider>,
  )
  return { ...view, props }
}

describe('AddToCollectionDialog', () => {
  it('groups editable collections into mine / program / other', () => {
    renderDialog()
    expect(
      within(screen.getByRole('list', { name: 'My collections' })).getByText('Skull comparison'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Program collections' })).getByText(
        'Chest positioning',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Other collections' })).getByText('Orphaned pairs'),
    ).toBeInTheDocument()
    expect(screen.getByText('2 images')).toBeInTheDocument()
    expect(screen.getByText('Sequence')).toBeInTheDocument()
  })

  it('omits empty groups', () => {
    renderDialog({ collections: [MINE] })
    expect(screen.getByRole('list', { name: 'My collections' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Program collections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Other collections' })).not.toBeInTheDocument()
  })

  it('calls onAdd with the picked collection and closes when it resolves true', async () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Skull comparison' }))
    await waitFor(() => expect(props.onAdd).toHaveBeenCalledWith(MINE))
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1))
  })

  it('stays open when onAdd resolves false and re-enables the rows', async () => {
    const { props } = renderDialog({ onAdd: vi.fn(async () => false) })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Skull comparison' }))
    await waitFor(() => expect(props.onAdd).toHaveBeenCalledTimes(1))
    expect(props.onClose).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to Chest positioning' })).not.toHaveAttribute(
        'aria-disabled',
      ),
    )
  })

  it('disables every row and the footer while an add is in flight', async () => {
    let finish: ((ok: boolean) => void) | undefined
    const onAdd = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    const { props } = renderDialog({ onAdd })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Skull comparison' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to Chest positioning' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    expect(screen.getByRole('button', { name: 'New collection…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    finish?.(true)
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it('disables a synchronized collection at the cap and explains why on hover', async () => {
    const user = userEvent.setup()
    renderDialog({
      collections: [
        makeCollectionSummary({ id: 1, name: 'Full sync', type: 'synchronized', imageCount: 4 }),
        makeCollectionSummary({ id: 2, name: 'Room left', type: 'synchronized', imageCount: 3 }),
        makeCollectionSummary({ id: 3, name: 'Big sequence', type: 'sequence', imageCount: 40 }),
      ],
    })
    const full = screen.getByRole('button', { name: 'Add to Full sync' })
    expect(full).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Add to Room left' })).not.toHaveAttribute(
      'aria-disabled',
    )
    expect(screen.getByRole('button', { name: 'Add to Big sequence' })).not.toHaveAttribute(
      'aria-disabled',
    )
    await user.hover(full.parentElement as HTMLElement)
    expect(await screen.findByText(CAP_REACHED_TOOLTIP)).toBeInTheDocument()
  })

  it('keeps under-cap synchronized rows clickable — membership dedupe is authoritative', () => {
    // The summary's imageCount cannot see which selected ids are already
    // members, so a borderline row must stay clickable: the add helper
    // dedupes and reports 'full' only for genuinely overflowing additions.
    renderDialog({
      imageIds: [42, 43],
      collections: [
        makeCollectionSummary({
          id: 1,
          name: 'Three so far',
          type: 'synchronized',
          imageCount: 3,
        }),
        makeCollectionSummary({ id: 2, name: 'Full sync', type: 'synchronized', imageCount: 4 }),
      ],
    })
    expect(screen.getByRole('button', { name: 'Add to Three so far' })).not.toHaveAttribute(
      'aria-disabled',
    )
    expect(screen.getByRole('button', { name: 'Add to Full sync' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText('Choose a collection for this 2 images.')).toBeInTheDocument()
  })

  it('disables a student sequence row at ten images and explains the cap', async () => {
    const user = userEvent.setup()
    renderDialog(
      {
        collections: [
          makeCollectionSummary({
            id: 9,
            name: 'Full sequence',
            type: 'sequence',
            imageCount: 10,
          }),
        ],
      },
      makeAuth('student'),
    )
    const row = screen.getByRole('button', { name: 'Add to Full sequence' })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    await user.hover(row.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Students can add at most 10 images to a sequence collection.',
    )
  })

  it('leaves a sequence row at ten images enabled for a non-student', () => {
    renderDialog(
      {
        collections: [
          makeCollectionSummary({
            id: 9,
            name: 'Long sequence',
            type: 'sequence',
            imageCount: 10,
          }),
        ],
      },
      makeAuth('instructor'),
    )
    expect(screen.getByRole('button', { name: 'Add to Long sequence' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('disables New collection when a student is at both type limits', async () => {
    const user = userEvent.setup()
    const collections = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeCollectionSummary({ id: i + 1, type: 'sequence' }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeCollectionSummary({ id: i + 11, type: 'synchronized' }),
      ),
    ]
    renderDialog({ collections }, makeAuth('student'))
    const button = screen.getByRole('button', { name: 'New collection…' })
    expect(button).toBeDisabled()
    await user.hover(button.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "You've reached the limit of 10 collections of each type.",
    )
  })

  it('filters by name and shows the no-match copy', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.type(screen.getByRole('textbox', { name: 'Filter collections' }), 'chest')
    expect(screen.getByRole('button', { name: 'Add to Chest positioning' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Add to Skull comparison' }),
    ).not.toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Filter collections' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter collections' }), 'zzz')
    expect(screen.getByText('No collections match “zzz”.')).toBeInTheDocument()
  })

  it('shows the loading spinner, the load error and the empty state', () => {
    const { rerender, props } = renderDialog({ loading: true, collections: [] })
    const wrap = (p: Partial<AddToCollectionDialogProps>) => (
      <AuthContext.Provider value={makeAuth('student')}>
        <AddToCollectionDialog {...props} {...p} />
      </AuthContext.Provider>
    )
    expect(screen.getByLabelText('Loading collections')).toBeInTheDocument()
    rerender(wrap({ loading: false, collections: [], error: 'Failed to load collections.' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load collections.')
    rerender(wrap({ loading: false, collections: [], error: null }))
    expect(screen.getByText("You don't have a collection you can add to yet.")).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Filter collections' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'New collection…' })).toBeEnabled()
  })

  it('creates a new collection through CollectionEditDialog and closes both', async () => {
    const user = userEvent.setup()
    const { props } = renderDialog({}, makeAuth('student'))
    await user.click(screen.getByRole('button', { name: 'New collection…' }))
    const heading = await screen.findByRole('heading', { name: 'New Collection' })
    expect(heading).toBeInTheDocument()
    expect(screen.queryByLabelText('Restricted — specific programs and/or groups')).toBeNull()
    await user.type(screen.getByLabelText('Collection name'), 'Fresh set')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(props.onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Fresh set', type: 'sequence', visibility: 'private' }),
      ),
    )
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1))
  })

  it('keeps the create form open with the message when onCreate rejects', async () => {
    const user = userEvent.setup()
    const { props } = renderDialog({ onCreate: vi.fn(async () => Promise.reject(new Error('x'))) })
    await user.click(screen.getByRole('button', { name: 'New collection…' }))
    await user.type(await screen.findByLabelText('Collection name'), 'Fresh set')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Failed to create collection.')).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('resets the filter when reopened', async () => {
    const user = userEvent.setup()
    const { rerender, props } = renderDialog()
    const wrap = (open: boolean) => (
      <AuthContext.Provider value={makeAuth('instructor')}>
        <AddToCollectionDialog {...props} open={open} />
      </AuthContext.Provider>
    )
    await user.type(screen.getByRole('textbox', { name: 'Filter collections' }), 'chest')
    rerender(wrap(false))
    rerender(wrap(true))
    expect(screen.getByRole('textbox', { name: 'Filter collections' })).toHaveValue('')
  })
})
