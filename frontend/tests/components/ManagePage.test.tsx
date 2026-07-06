import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchImages: vi.fn(),
    updateImage: vi.fn(),
    deleteImage: vi.fn(),
    replaceImage: vi.fn(),
    bulkUpdateImages: vi.fn(),
    bulkDeleteImages: vi.fn(),
  }
})

import { fetchImages, updateImage } from '../../src/api'
import type { ApiImage } from '../../src/api'
import type { Group, Program } from '../../src/types'
import { makeCategory } from '../helpers/fixtures'
import ManagePage from '../../src/components/ManagePage'
import { resetCategoryTreeExpansionPreferencesForTests } from '../../src/useCategoryTreeExpansionPreferences'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
]

const groups: Group[] = [
  {
    id: 7,
    name: 'Lab A2',
    description: null,
    createdByUserId: 1,
    memberIds: [],
    instructorIds: [1],
    createdAt: '',
    updatedAt: '',
  },
]

const categories = [
  makeCategory({
    id: 10,
    label: 'Microscopy',
    programIds: [1],
    groupIds: [7],
  }),
]

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('ManagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
    resetCategoryTreeExpansionPreferencesForTests()
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Blood Smear',
        thumb: '/thumb.jpg',
        tile_sources: '/tile.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])
  })

  it('renders a Groups column with group chips for image category restrictions', async () => {
    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
    })

    expect(screen.getByRole('columnheader', { name: 'Groups' })).toBeInTheDocument()
    const groupChip = screen.getByText('Lab A2').closest('.MuiChip-root')
    expect(groupChip).toBeInTheDocument()
  })

  it('renders pagination controls at both the top and bottom of the table (#668)', async () => {
    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')

    expect(screen.getAllByLabelText('Go to next page')).toHaveLength(2)
    expect(screen.getAllByLabelText('Go to previous page')).toHaveLength(2)
  })

  it('marks non-interactive cells of dimmed (inactive) rows with data-dimmed, leaving interactive cells unmarked (#651)', async () => {
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Blood Smear',
        thumb: '/thumb.jpg',
        tile_sources: '/tile.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: false,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])

    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    const nameCell = (await screen.findByText('Blood Smear')).closest('td')
    expect(nameCell).toHaveAttribute('data-dimmed')

    const actionsCell = screen.getByRole('button', { name: 'actions' }).closest('td')
    expect(actionsCell).not.toHaveAttribute('data-dimmed')
  })

  it('uses reduced opacity for inherited program and group chips', async () => {
    const inheritedCategories = [
      makeCategory({
        id: 1,
        label: 'Parent',
        programIds: [1],
        groupIds: [7],
        children: [
          makeCategory({
            id: 10,
            label: 'Microscopy',
            parentId: 1,
          }),
        ],
      }),
    ]
    localStorage.setItem(
      'hrivpref:table-columns:manage-images:user:1',
      JSON.stringify({
        thumbnail: true,
        id: false,
        name: true,
        category: true,
        copyright: false,
        note: false,
        program: true,
        group: true,
        active: true,
        updated_at: true,
        created_at: false,
        dimensions: false,
        file_size: false,
        measurement: false,
        annotations: false,
      }),
    )

    render(<ManagePage categories={inheritedCategories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')

    expect(screen.getByText('Medical Lab').closest('.MuiChip-root')).toHaveStyle({ opacity: '0.6' })
    expect(screen.getByText('Lab A2').closest('.MuiChip-root')).toHaveStyle({ opacity: '0.6' })
  })

  it('shows the configured default visible columns', async () => {
    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Groups' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Visibility' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Modified' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'ID' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Program' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Copyright' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Note' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Created' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Dimensions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'File Size' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Measurement' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Annotations' })).not.toBeInTheDocument()
  })

  it('shows the annotations column only after enabling it in the column chooser', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Annotated Slide',
        thumb: '/thumb-a.jpg',
        tile_sources: '/tile-a.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: { canvas_annotations: [{ id: 'annotation-1' }] },
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 102,
        name: 'Unannotated Slide',
        thumb: '/thumb-b.jpg',
        tile_sources: '/tile-b.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 1,
        metadata_extra: { canvas_annotations: [] },
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])

    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Annotated Slide')

    expect(screen.queryByRole('columnheader', { name: 'Annotations' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Choose columns' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose image table columns' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Annotations' }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Annotations' })).toBeInTheDocument()
    })

    const annotatedRow = screen.getByText('Annotated Slide').closest('tr')
    const unannotatedRow = screen.getByText('Unannotated Slide').closest('tr')
    expect(annotatedRow).not.toBeNull()
    expect(unannotatedRow).not.toBeNull()
    expect(
      within(annotatedRow as HTMLElement).getByLabelText('Has annotations'),
    ).toBeInTheDocument()
    expect(
      within(unannotatedRow as HTMLElement).queryByLabelText('Has annotations'),
    ).not.toBeInTheDocument()
  })

  it('keeps the filter bar in sync with visible columns', async () => {
    const user = userEvent.setup()
    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    expect(within(filterBar).getByRole('button', { name: 'Group' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Choose columns' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose image table columns' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Groups' }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Choose image table columns' }),
      ).not.toBeInTheDocument()
    })

    expect(screen.queryByRole('columnheader', { name: 'Groups' })).not.toBeInTheDocument()
    expect(within(filterBar).queryByRole('button', { name: 'Group' })).not.toBeInTheDocument()
  })

  it('shows the filtered result total beside the active chips only when a filter is applied', async () => {
    const user = userEvent.setup()
    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')

    expect(screen.queryByText('1 of 1 image')).not.toBeInTheDocument()

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    await user.click(within(filterBar).getByRole('button', { name: 'Group' }))
    expect(screen.queryByPlaceholderText('Select groups')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Lab A2' }))

    await waitFor(() => {
      expect(screen.getByText('1 of 1 image')).toBeInTheDocument()
    })
  })

  it('shows an in-table no-match message when filters exclude all images', async () => {
    const user = userEvent.setup()
    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    await user.click(within(filterBar).getByRole('button', { name: 'Name' }))
    await user.type(screen.getByPlaceholderText('Filter by name'), 'No Match')

    await waitFor(() => {
      expect(screen.getByText('No images match the selected filters.')).toBeInTheDocument()
      expect(screen.getByText('0 of 1 image')).toBeInTheDocument()
    })
  })

  it('treats comma-only persisted text filters as inactive chrome', async () => {
    localStorage.setItem(
      'hrivpref:table-filters:manage-images:user:1',
      JSON.stringify({
        text: { name: ' , ,' },
        programs: [],
        groups: [],
        visibility: [],
      }),
    )

    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    expect(within(filterBar).queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
    expect(screen.queryByText('1 of 1 image')).not.toBeInTheDocument()
  })

  it('prunes stale persisted program selections after hydrating filters', async () => {
    localStorage.setItem(
      'hrivpref:table-filters:manage-images:user:1',
      JSON.stringify({
        text: {},
        programs: [999],
        groups: [],
        visibility: [],
      }),
    )

    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
    })

    expect(screen.queryByText('No images match the selected filters.')).not.toBeInTheDocument()
  })

  it('prunes stale persisted category selections after hydrating filters', async () => {
    localStorage.setItem(
      'hrivpref:table-filters:manage-images:user:1',
      JSON.stringify({
        text: {},
        programs: [],
        groups: [],
        visibility: [],
        categories: [999],
      }),
    )

    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await waitFor(() => {
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
    })

    expect(screen.queryByText('Category:')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(
        JSON.parse(localStorage.getItem('hrivpref:table-filters:manage-images:user:1') ?? '{}'),
      ).toMatchObject({ categories: [] })
    })
  })

  it('preserves non-program persisted filters when navigation selects a program', async () => {
    const twoPrograms: Program[] = [
      ...programs,
      { id: 2, name: 'Other Program', oidc_group: null, created_at: '', updated_at: '' },
    ]
    const twoCategories = [
      makeCategory({ id: 10, label: 'Microscopy A', programIds: [1], groupIds: [7] }),
      makeCategory({ id: 11, label: 'Microscopy B', programIds: [2], groupIds: [7] }),
    ]
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Persisted Filter Target',
        thumb: '/thumb-a.jpg',
        tile_sources: '/tile-a.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 102,
        name: 'Navigation Target',
        thumb: '/thumb-b.jpg',
        tile_sources: '/tile-b.dzi',
        category_id: 11,
        copyright: null,
        note: null,
        active: true,
        sort_order: 1,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])
    localStorage.setItem(
      'hrivpref:table-filters:manage-images:user:1',
      JSON.stringify({
        text: { name: 'Persisted' },
        programs: [1],
        groups: [],
        visibility: [],
      }),
    )

    render(
      <ManagePage
        categories={twoCategories}
        programs={twoPrograms}
        groups={groups}
        initialProgramFilter="Other Program"
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Filter by' })).toBeInTheDocument()
    })

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    const nameButton = within(filterBar).getByRole('button', { name: 'Name' })
    const programButton = within(filterBar).getByRole('button', { name: 'Program' })

    expect(programButton).toHaveTextContent('1')
    expect(nameButton).toHaveTextContent('1')
    expect(screen.queryByText('Navigation Target')).not.toBeInTheDocument()
    expect(screen.getByText('No images match the selected filters.')).toBeInTheDocument()
  })

  it('filters images by category subtree and restores selected categories from localStorage', async () => {
    const user = userEvent.setup()
    const categoryTree = [
      makeCategory({
        id: 1,
        label: 'Architecture',
        children: [
          makeCategory({ id: 4, label: 'American', parentId: 1 }),
          makeCategory({
            id: 3,
            label: 'Italian',
            parentId: 1,
            children: [makeCategory({ id: 5, label: 'Gothic', parentId: 3 })],
          }),
        ],
      }),
      makeCategory({ id: 2, label: 'Panoramas' }),
    ]
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Duomo',
        thumb: '/thumb-a.jpg',
        tile_sources: '/tile-a.dzi',
        category_id: 3,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 102,
        name: 'Duomo Gothic Detail',
        thumb: '/thumb-b.jpg',
        tile_sources: '/tile-b.dzi',
        category_id: 5,
        copyright: null,
        note: null,
        active: true,
        sort_order: 1,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 103,
        name: 'Highsmith',
        thumb: '/thumb-c.jpg',
        tile_sources: '/tile-c.dzi',
        category_id: 4,
        copyright: null,
        note: null,
        active: true,
        sort_order: 2,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 104,
        name: 'Library of Congress',
        thumb: '/thumb-d.jpg',
        tile_sources: '/tile-d.dzi',
        category_id: 2,
        copyright: null,
        note: null,
        active: true,
        sort_order: 3,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])

    const { unmount } = render(
      <ManagePage categories={categoryTree} programs={programs} groups={groups} />,
    )

    await screen.findByText('Duomo')
    await screen.findByText('Duomo Gothic Detail')
    await screen.findByText('Highsmith')
    await screen.findByText('Library of Congress')

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    await user.click(filterBar.querySelector('button[aria-label="Category"]') as HTMLElement)
    const architectureRow = screen.getAllByRole('menuitemcheckbox', { name: /Architecture/ })[0]
    await user.click(within(architectureRow).getByRole('checkbox'))

    await waitFor(() => {
      expect(screen.getByText('Category: Architecture')).toBeInTheDocument()
      expect(screen.getByText('Duomo')).toBeInTheDocument()
      expect(screen.getByText('Duomo Gothic Detail')).toBeInTheDocument()
      expect(screen.getByText('Highsmith')).toBeInTheDocument()
      expect(screen.queryByText('Library of Congress')).not.toBeInTheDocument()
      expect(
        JSON.parse(localStorage.getItem('hrivpref:table-filters:manage-images:user:1') ?? '{}'),
      ).toMatchObject({ categories: [1] })
    })

    unmount()
    render(<ManagePage categories={categoryTree} programs={programs} groups={groups} />)

    await screen.findByText('Duomo')
    expect(screen.getByText('Category: Architecture')).toBeInTheDocument()
    expect(screen.queryByText('Library of Congress')).not.toBeInTheDocument()
  })

  it('deletes one category chip without clearing sibling category selections', async () => {
    const user = userEvent.setup()
    const categoryTree = [
      makeCategory({
        id: 1,
        label: 'Architecture',
        children: [
          makeCategory({ id: 4, label: 'American', parentId: 1 }),
          makeCategory({
            id: 3,
            label: 'Italian',
            parentId: 1,
            children: [makeCategory({ id: 5, label: 'Gothic', parentId: 3 })],
          }),
        ],
      }),
      makeCategory({ id: 2, label: 'Panoramas' }),
    ]
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Duomo',
        thumb: '/thumb-a.jpg',
        tile_sources: '/tile-a.dzi',
        category_id: 3,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 102,
        name: 'Duomo Gothic Detail',
        thumb: '/thumb-b.jpg',
        tile_sources: '/tile-b.dzi',
        category_id: 5,
        copyright: null,
        note: null,
        active: true,
        sort_order: 1,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 103,
        name: 'Highsmith',
        thumb: '/thumb-c.jpg',
        tile_sources: '/tile-c.dzi',
        category_id: 4,
        copyright: null,
        note: null,
        active: true,
        sort_order: 2,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 104,
        name: 'Library of Congress',
        thumb: '/thumb-d.jpg',
        tile_sources: '/tile-d.dzi',
        category_id: 2,
        copyright: null,
        note: null,
        active: true,
        sort_order: 3,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])

    render(<ManagePage categories={categoryTree} programs={programs} groups={groups} />)

    await screen.findByText('Duomo')
    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    await user.click(filterBar.querySelector('button[aria-label="Category"]') as HTMLElement)

    const architectureRow = screen.getAllByRole('menuitemcheckbox', { name: /Architecture/ })[0]
    const panoramasRow = screen.getAllByRole('menuitemcheckbox', { name: /Panoramas/ })[0]
    await user.click(within(architectureRow).getByRole('checkbox'))
    await user.click(within(panoramasRow).getByRole('checkbox'))

    await waitFor(() => {
      expect(screen.getByText('Category: Architecture')).toBeInTheDocument()
      expect(screen.getByText('Category: Panoramas')).toBeInTheDocument()
      expect(screen.getByText('4 of 4 images')).toBeInTheDocument()
    })

    const architectureChip = screen.getByText('Category: Architecture').closest('.MuiChip-root')
    expect(architectureChip).not.toBeNull()
    fireEvent.click(within(architectureChip as HTMLElement).getByTestId('CancelIcon'))

    await waitFor(() => {
      expect(screen.queryByText('Category: Architecture')).not.toBeInTheDocument()
      expect(screen.getByText('Category: Panoramas')).toBeInTheDocument()
      expect(screen.queryByText('Duomo')).not.toBeInTheDocument()
      expect(screen.queryByText('Duomo Gothic Detail')).not.toBeInTheDocument()
      expect(screen.queryByText('Highsmith')).not.toBeInTheDocument()
      expect(screen.getByText('Library of Congress')).toBeInTheDocument()
      expect(screen.getByText('1 of 4 images')).toBeInTheDocument()
      expect(
        JSON.parse(localStorage.getItem('hrivpref:table-filters:manage-images:user:1') ?? '{}'),
      ).toMatchObject({ categories: [2] })
    })
  })

  it('matches comma-separated name filters with AND semantics', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Blood Smear',
        thumb: '/thumb-a.jpg',
        tile_sources: '/tile-a.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 102,
        name: 'Urine Slide',
        thumb: '/thumb-b.jpg',
        tile_sources: '/tile-b.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 1,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])

    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')
    await screen.findByText('Urine Slide')

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    const nameFilterButton = within(filterBar).getByRole('button', { name: 'Name' })
    await user.click(nameFilterButton)
    await user.type(screen.getByPlaceholderText('Filter by name'), 'Blood, Smear')
    await user.click(nameFilterButton)

    expect(screen.getByText('Blood Smear')).toBeInTheDocument()
    expect(screen.queryByText('Urine Slide')).not.toBeInTheDocument()
    expect(within(filterBar).getByText('Name: Blood')).toBeInTheDocument()
    expect(within(filterBar).getByText('Name: Smear')).toBeInTheDocument()
    expect(within(filterBar).queryByText('Name: Blood, Smear')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 2 images')).toBeInTheDocument()

    const bloodChip = within(filterBar).getByText('Name: Blood').closest('.MuiChip-root')
    expect(bloodChip).not.toBeNull()
    fireEvent.click(within(bloodChip as HTMLElement).getByTestId('CancelIcon'))

    expect(within(filterBar).queryByText('Name: Blood')).not.toBeInTheDocument()
    expect(within(filterBar).getByText('Name: Smear')).toBeInTheDocument()
    expect(screen.getByText('Blood Smear')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 images')).toBeInTheDocument()
  })

  it('removes same-column text chips through the latest filter state', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Blood Smear',
        thumb: '/thumb-a.jpg',
        tile_sources: '/tile-a.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 102,
        name: 'Urine Slide',
        thumb: '/thumb-b.jpg',
        tile_sources: '/tile-b.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 1,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])

    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')
    await screen.findByText('Urine Slide')

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    const nameFilterButton = within(filterBar).getByRole('button', { name: 'Name' })
    await user.click(nameFilterButton)
    await user.type(screen.getByPlaceholderText('Filter by name'), 'Blood, Smear')
    await user.click(nameFilterButton)

    expect(within(filterBar).getByText('Name: Blood')).toBeInTheDocument()
    expect(within(filterBar).getByText('Name: Smear')).toBeInTheDocument()

    const deleteIcons = within(filterBar).getAllByTestId('CancelIcon')
    fireEvent.click(deleteIcons[0])
    fireEvent.click(deleteIcons[1])

    await waitFor(() => {
      expect(within(filterBar).queryByText('Name: Blood')).not.toBeInTheDocument()
      expect(within(filterBar).queryByText('Name: Smear')).not.toBeInTheDocument()
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
      expect(screen.getByText('Urine Slide')).toBeInTheDocument()
    })
  })

  it('keeps duplicate program names as distinct filter options keyed by id', async () => {
    const duplicatePrograms: Program[] = [
      { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
      { id: 2, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
    ]
    const duplicateCategories = [
      makeCategory({ id: 10, label: 'Microscopy A', programIds: [1], groupIds: [7] }),
      makeCategory({ id: 11, label: 'Microscopy B', programIds: [2], groupIds: [7] }),
    ]
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Blood Smear',
        thumb: '/thumb-a.jpg',
        tile_sources: '/tile-a.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 102,
        name: 'Urine Slide',
        thumb: '/thumb-b.jpg',
        tile_sources: '/tile-b.dzi',
        category_id: 11,
        copyright: null,
        note: null,
        active: true,
        sort_order: 1,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])
    localStorage.setItem(
      'hrivpref:table-columns:manage-images:user:1',
      JSON.stringify({
        thumbnail: true,
        id: false,
        name: true,
        category: true,
        copyright: false,
        note: false,
        program: true,
        group: true,
        active: true,
        updated_at: true,
        created_at: false,
        dimensions: false,
        file_size: false,
        measurement: false,
        annotations: false,
      }),
    )

    const user = userEvent.setup()
    render(
      <ManagePage categories={duplicateCategories} programs={duplicatePrograms} groups={groups} />,
    )

    await screen.findByText('Blood Smear')
    await screen.findByText('Urine Slide')

    const filterBar = screen.getByRole('region', { name: 'Filter by' })
    await user.click(within(filterBar).getByRole('button', { name: 'Program' }))

    const options = await screen.findAllByRole('menuitemcheckbox', { name: 'Medical Lab' })
    expect(options).toHaveLength(2)

    await user.click(options[0])

    await waitFor(() => {
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
      expect(screen.queryByText('Urine Slide')).not.toBeInTheDocument()
      expect(screen.getByText('1 of 2 images')).toBeInTheDocument()
    })
  })

  it('adds program chip-click filters instead of replacing the existing selection', async () => {
    const additivePrograms: Program[] = [
      { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
      { id: 2, name: 'Nursing', oidc_group: null, created_at: '', updated_at: '' },
    ]
    const additiveCategories = [
      makeCategory({ id: 10, label: 'Microscopy', programIds: [1, 2], groupIds: [7] }),
      makeCategory({ id: 11, label: 'Histology', programIds: [2], groupIds: [7] }),
    ]
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Blood Smear',
        thumb: '/thumb-a.jpg',
        tile_sources: '/tile-a.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 102,
        name: 'Tissue Section',
        thumb: '/thumb-b.jpg',
        tile_sources: '/tile-b.dzi',
        category_id: 11,
        copyright: null,
        note: null,
        active: true,
        sort_order: 1,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])
    localStorage.setItem(
      'hrivpref:table-columns:manage-images:user:1',
      JSON.stringify({
        thumbnail: true,
        id: false,
        name: true,
        category: true,
        copyright: false,
        note: false,
        program: true,
        group: true,
        active: true,
        updated_at: true,
        created_at: false,
        dimensions: false,
        file_size: false,
        measurement: false,
        annotations: false,
      }),
    )

    const user = userEvent.setup()
    render(
      <ManagePage categories={additiveCategories} programs={additivePrograms} groups={groups} />,
    )

    await screen.findByText('Blood Smear')
    await screen.findByText('Tissue Section')

    await user.click(screen.getByText('Medical Lab'))
    await waitFor(() => {
      expect(screen.getByText('Program: Medical Lab')).toBeInTheDocument()
      expect(screen.getByText('1 of 2 images')).toBeInTheDocument()
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
      expect(screen.queryByText('Tissue Section')).not.toBeInTheDocument()
    })

    const bloodSmearRow = screen.getByText('Blood Smear').closest('tr')
    expect(bloodSmearRow).not.toBeNull()
    await user.click(within(bloodSmearRow as HTMLElement).getByText('Nursing'))
    await waitFor(() => {
      expect(screen.getByText('Program: Medical Lab')).toBeInTheDocument()
      expect(screen.getByText('Program: Nursing')).toBeInTheDocument()
      expect(screen.getByText('2 of 2 images')).toBeInTheDocument()
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
      expect(screen.getByText('Tissue Section')).toBeInTheDocument()
    })
  })

  it('greyscales the thumbnail when an image is inactive', async () => {
    vi.mocked(fetchImages).mockResolvedValue([
      {
        id: 101,
        name: 'Blood Smear',
        thumb: '/thumb.jpg',
        tile_sources: '/tile.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: false,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ])

    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    const thumbnail = await screen.findByAltText('Blood Smear')
    expect(thumbnail).toHaveStyle({ filter: 'grayscale(100%)' })
  })

  it('toggles visibility without refetching the image list', async () => {
    vi.mocked(updateImage).mockResolvedValue({
      id: 101,
      name: 'Blood Smear',
      thumb: '/thumb.jpg',
      tile_sources: '/tile.dzi',
      category_id: 10,
      copyright: null,
      note: null,
      active: false,
      sort_order: 0,
      metadata_extra: null,
      version: 2,
      width: null,
      height: null,
      file_size: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-03T00:00:00Z',
    })

    const { container } = render(
      <ManagePage categories={categories} programs={programs} groups={groups} />,
    )

    await screen.findByText('Blood Smear')
    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'))
    const toggle = checkboxes.find((input) => input.checked)
    expect(toggle).toBeDefined()
    fireEvent.click(toggle!)

    await waitFor(() => {
      expect(updateImage).toHaveBeenCalledWith(101, { active: false }, 1)
    })
    expect(fetchImages).toHaveBeenCalledTimes(1)
  })

  it('keeps the image table mounted during a background refresh after initial load', async () => {
    const firstFetch = createDeferred<ApiImage[]>()
    const secondFetch = createDeferred<ApiImage[]>()
    const images: ApiImage[] = [
      {
        id: 101,
        name: 'Blood Smear',
        thumb: '/thumb.jpg',
        tile_sources: '/tile.dzi',
        category_id: 10,
        copyright: null,
        note: null,
        active: true,
        sort_order: 0,
        metadata_extra: null,
        version: 1,
        width: null,
        height: null,
        file_size: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ]
    vi.mocked(fetchImages)
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementationOnce(() => secondFetch.promise)

    const { rerender } = render(
      <ManagePage categories={categories} programs={programs} groups={groups} />,
    )

    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    await act(async () => {
      firstFetch.resolve(images)
    })

    await screen.findByText('Blood Smear')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    rerender(
      <ManagePage categories={categories} programs={programs} groups={groups} imagesVersion={1} />,
    )

    await waitFor(() => {
      expect(fetchImages).toHaveBeenCalledTimes(2)
    })

    expect(screen.getByText('Blood Smear')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    await act(async () => {
      secondFetch.resolve(images)
    })
    await waitFor(() => {
      expect(screen.getByText('Blood Smear')).toBeInTheDocument()
    })
  })

  it('persists selected columns between renders', async () => {
    const storageKey = 'hrivpref:table-columns:manage-images:user:1'
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        thumbnail: true,
        id: false,
        name: true,
        category: true,
        copyright: false,
        note: false,
        program: true,
        group: true,
        active: true,
        updated_at: true,
        created_at: false,
        dimensions: false,
        file_size: false,
        measurement: false,
      }),
    )

    const { unmount } = render(
      <ManagePage categories={categories} programs={programs} groups={groups} />,
    )

    await screen.findByText('Blood Smear')
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}')).toMatchObject({
      program: true,
    })

    expect(screen.getByRole('columnheader', { name: 'Program' })).toBeInTheDocument()

    unmount()
    render(<ManagePage categories={categories} programs={programs} groups={groups} />)

    await screen.findByText('Blood Smear')
    expect(screen.getByRole('columnheader', { name: 'Program' })).toBeInTheDocument()
  })

  it('shows hidden-by-category tooltips for inherited hidden row indicators', async () => {
    const inheritedHiddenCategories = [
      makeCategory({
        id: 1,
        label: 'Parent',
        status: 'hidden',
        children: [
          makeCategory({
            id: 10,
            label: 'Microscopy',
            parentId: 1,
            programIds: [1],
            groupIds: [7],
          }),
        ],
      }),
    ]

    render(
      <ManagePage categories={inheritedHiddenCategories} programs={programs} groups={groups} />,
    )

    await screen.findByText('Blood Smear')

    const breadcrumbIcon = screen.getByLabelText('Category hidden from students by ancestor')
    fireEvent.mouseOver(breadcrumbIcon)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Hidden by category')

    const visibilitySwitch = screen.getByRole('switch')
    expect(visibilitySwitch).toBeDisabled()
    fireEvent.mouseOver(visibilitySwitch.closest('span') as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Hidden by category')
  })
})
