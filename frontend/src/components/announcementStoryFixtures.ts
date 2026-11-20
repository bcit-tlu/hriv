import type { ApiAnnouncement } from '../api'
import type { UseAnnouncementsResult } from '../useAnnouncements'

/** Deterministic fixtures for the announcement stories (literal dates, no Date.now()). */
export function storyAnnouncement(overrides: Partial<ApiAnnouncement> = {}): ApiAnnouncement {
  return {
    id: 1,
    title: 'Lab 3 moved to Thursday',
    message:
      'The **Thursday** session now runs 13:30–16:20 in SW1-2015.\n\n- Bring your stained slides\n- Review the [grading rubric](https://example.ca/rubric)',
    kind: 'notice',
    icon: 'campaign',
    severity: 'info',
    audience: 'targeted',
    author_id: 7,
    author_name: 'Dr. Ada Lovelace',
    program_ids: [],
    program_names: [],
    group_ids: [3],
    group_names: ['Histology 2024'],
    publish_at: '2024-03-04T17:00:00+00:00',
    expires_at: null,
    notified_at: '2024-03-04T17:00:00+00:00',
    pinned: false,
    banner: false,
    status: 'live',
    seen: false,
    reactions: {},
    my_reactions: [],
    media_tokens: {},
    can_edit: false,
    created_at: '2024-03-04T17:00:00+00:00',
    updated_at: '2024-03-04T17:00:00+00:00',
    ...overrides,
  }
}

export const storyInbox: ApiAnnouncement[] = [
  storyAnnouncement({
    id: 3,
    kind: 'celebration',
    severity: 'success',
    title: 'Congratulations to the 2024 graduating cohort!',
    message: 'Proud of every one of you. 🎓',
    audience: 'everyone',
    group_ids: [],
    group_names: [],
    pinned: true,
    reactions: { hooray: 12, heart: 7, clap: 3 },
    my_reactions: ['hooray'],
    publish_at: '2024-05-20T16:00:00+00:00',
    notified_at: '2024-05-20T16:00:00+00:00',
  }),
  storyAnnouncement({ id: 1 }),
  storyAnnouncement({
    id: 2,
    kind: 'release',
    title: 'HRIV 2.5: object counting in the viewer',
    message: 'Counting mode is now available from the viewer toolbar. See the guide for details.',
    audience: 'staff',
    group_ids: [],
    group_names: [],
    author_id: null,
    author_name: '',
    seen: true,
    reactions: { rocket: 2 },
    publish_at: '2024-02-12T09:00:00+00:00',
    notified_at: '2024-02-12T09:00:00+00:00',
  }),
]

const noop = () => {}
const noopAsync = async () => {}

export function storyFeed(overrides: Partial<UseAnnouncementsResult> = {}): UseAnnouncementsResult {
  return {
    announcements: storyInbox,
    unseenCount: storyInbox.filter((a) => !a.seen).length,
    loading: false,
    error: null,
    reload: noopAsync,
    markSeen: noop,
    upsert: noop,
    remove: noop,
    toggleReaction: noopAsync,
    ...overrides,
  }
}
