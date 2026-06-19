import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
import type { Group, Program } from '../../src/types'
import { makeCategory } from '../helpers/fixtures'
import ManagePage from '../../src/components/ManagePage'

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

describe('ManagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('hriv_user', JSON.stringify({ id: 1 }))
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

    expect(screen.getByText('Groups')).toBeInTheDocument()
    const groupChip = screen.getByText('Lab A2').closest('.MuiChip-root')
    expect(groupChip).toBeInTheDocument()
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
