import { describe, it, expect } from 'vitest'
import { apiGroupToGroup } from '../src/groupUtils'
import type { ApiGroup } from '../src/api'

describe('apiGroupToGroup', () => {
  it('maps snake_case ApiGroup fields to the camelCase domain Group', () => {
    const api: ApiGroup = {
      id: 7,
      name: 'Cohort A',
      description: 'First cohort',
      created_by_user_id: 10,
      member_ids: [101, 102],
      instructor_ids: [10, 11],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    }
    expect(apiGroupToGroup(api)).toEqual({
      id: 7,
      name: 'Cohort A',
      description: 'First cohort',
      createdByUserId: 10,
      memberIds: [101, 102],
      instructorIds: [10, 11],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    })
  })

  it('preserves null description and null created_by_user_id', () => {
    const api: ApiGroup = {
      id: 1,
      name: 'Admin-created',
      description: null,
      created_by_user_id: null,
      member_ids: [],
      instructor_ids: [],
      created_at: '',
      updated_at: '',
    }
    const mapped = apiGroupToGroup(api)
    expect(mapped.description).toBeNull()
    expect(mapped.createdByUserId).toBeNull()
    expect(mapped.memberIds).toEqual([])
    expect(mapped.instructorIds).toEqual([])
  })
})
