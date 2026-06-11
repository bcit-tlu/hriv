import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

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

import { fetchImages } from '../../src/api'
import type { Group, Program } from '../../src/types'
import { makeCategory } from '../helpers/fixtures'
import ManagePage from '../../src/components/ManagePage'

const programs: Program[] = [
  { id: 1, name: 'Medical Lab', oidc_group: null, created_at: '', updated_at: '' },
]

const groups: Group[] = [
  { id: 7, name: 'Lab A2', description: null, createdByUserId: 1, memberIds: [], instructorIds: [1], createdAt: '', updatedAt: '' },
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
})
