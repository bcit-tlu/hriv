import type { ApiAnnouncement } from '../src/api'

export function makeAnnouncement(overrides: Partial<ApiAnnouncement> = {}): ApiAnnouncement {
  return {
    id: 1,
    title: 'Lab 3 moved to Thursday',
    message: 'Bring your **slides**.',
    kind: 'notice',
    icon: 'campaign',
    severity: 'info',
    audience: 'targeted',
    author_id: 7,
    author_name: 'Dr. Ada Lovelace',
    program_ids: [],
    program_names: [],
    group_ids: [3],
    group_names: ['Histology 2026'],
    publish_at: '2026-03-02T17:00:00+00:00',
    expires_at: null,
    notified_at: '2026-03-02T17:00:00+00:00',
    pinned: false,
    banner: false,
    status: 'live',
    seen: false,
    reactions: {},
    my_reactions: [],
    media_tokens: {},
    can_edit: false,
    created_at: '2026-03-02T17:00:00+00:00',
    updated_at: '2026-03-02T17:00:00+00:00',
    ...overrides,
  }
}
