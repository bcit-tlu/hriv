import type { ApiGroup } from './api'
import type { Group } from './types'

/** Map a backend ApiGroup (snake_case) to the camelCase domain Group type. */
export function apiGroupToGroup(g: ApiGroup): Group {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    createdByUserId: g.created_by_user_id,
    memberIds: g.member_ids,
    instructorIds: g.instructor_ids,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
  }
}
