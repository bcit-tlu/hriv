import type { SvgIconComponent } from '@mui/icons-material'
import CampaignIcon from '@mui/icons-material/Campaign'
import CelebrationIcon from '@mui/icons-material/Celebration'
import EventIcon from '@mui/icons-material/Event'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type {
  AnnouncementAudience,
  AnnouncementKind,
  AnnouncementStatus,
  ApiAnnouncement,
} from './api'

export type AnnouncementSeverity = 'info' | 'success' | 'warning' | 'error'

export interface AnnouncementKindMeta {
  kind: AnnouncementKind
  label: string
  Icon: SvgIconComponent
  severity: AnnouncementSeverity
  /** Border/icon colour on cards and banners; one per kind so a re-kinded post visibly changes. */
  accent: string
  /** Only admins may post this kind (product decision: the icon *is* the kind). */
  adminOnly: boolean
}

/** The controlled icon set — picking an icon picks the kind and its severity. */
export const ANNOUNCEMENT_KINDS: readonly AnnouncementKindMeta[] = [
  {
    kind: 'notice',
    label: 'Notice',
    Icon: CampaignIcon,
    severity: 'info',
    accent: '#0288D1',
    adminOnly: false,
  },
  {
    kind: 'event',
    label: 'Event',
    Icon: EventIcon,
    severity: 'info',
    accent: '#7B1FA2',
    adminOnly: false,
  },
  {
    kind: 'reminder',
    label: 'Reminder',
    Icon: NotificationsActiveIcon,
    severity: 'info',
    accent: '#00897B',
    adminOnly: false,
  },
  {
    kind: 'celebration',
    label: 'Celebration',
    Icon: CelebrationIcon,
    severity: 'success',
    accent: '#2E7D32',
    adminOnly: false,
  },
  {
    kind: 'release',
    label: 'Release',
    Icon: RocketLaunchIcon,
    severity: 'info',
    accent: '#3949AB',
    adminOnly: true,
  },
  {
    kind: 'warning',
    label: 'Important',
    Icon: WarningAmberIcon,
    severity: 'warning',
    accent: '#ED6C02',
    adminOnly: true,
  },
]

export function kindMeta(kind: string): AnnouncementKindMeta {
  return ANNOUNCEMENT_KINDS.find((k) => k.kind === kind) ?? ANNOUNCEMENT_KINDS[0]
}

/** Shared `sx` for the outlined, white-filled card/banner Alert with the kind's accent. */
export function kindAlertSx(meta: AnnouncementKindMeta) {
  return {
    bgcolor: 'background.paper',
    borderColor: meta.accent,
    '& .MuiAlert-icon': { color: meta.accent },
  }
}

export function kindsForRole(isAdmin: boolean): AnnouncementKindMeta[] {
  return ANNOUNCEMENT_KINDS.filter((k) => isAdmin || !k.adminOnly)
}

/** Allowlisted reactions (mirrors the backend set); emoji are engagement only. */
export const ANNOUNCEMENT_REACTIONS: ReadonlyArray<{ id: string; glyph: string; label: string }> = [
  { id: '+1', glyph: '👍', label: 'Thumbs up' },
  { id: 'heart', glyph: '❤️', label: 'Heart' },
  { id: 'laugh', glyph: '😄', label: 'Laugh' },
  { id: 'confused', glyph: '😕', label: 'Confused' },
  { id: 'hooray', glyph: '🎉', label: 'Hooray' },
  { id: 'rocket', glyph: '🚀', label: 'Rocket' },
  { id: 'eyes', glyph: '👀', label: 'Eyes' },
  { id: 'clap', glyph: '👏', label: 'Clap' },
]

export function reactionGlyph(id: string): string {
  return ANNOUNCEMENT_REACTIONS.find((r) => r.id === id)?.glyph ?? id
}

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  expired: 'Expired',
}

/** Chips describing who a post reaches, in display order. */
/** Reader-facing names of the role-resolved audiences (programs/groups use their own names). */
export const AUDIENCE_LABELS: Partial<Record<AnnouncementAudience, string>> = {
  everyone: 'Everyone',
  staff: 'Admins, Instructors, and Staff',
  admins: 'Admins',
  instructors: 'Instructors',
  staff_only: 'Staff',
}

/** Program names that stand for the admin team; shown pluralised as "Admins". */
export const ADMIN_PROGRAM_NAMES: ReadonlySet<string> = new Set(['Admin', 'Administration'])
export const ADMIN_PROGRAM_LABEL = 'Admins'

export function audienceChips(
  a: Pick<ApiAnnouncement, 'audience' | 'program_names' | 'group_names'>,
) {
  const label = AUDIENCE_LABELS[a.audience]
  if (label) return [label]
  const programs = a.program_names.map((n) =>
    ADMIN_PROGRAM_NAMES.has(n) ? ADMIN_PROGRAM_LABEL : n,
  )
  return [...programs, ...a.group_names]
}

/** Sort key for feeds: pinned first, then newest publish/notify time. */
export function sortAnnouncements(rows: ApiAnnouncement[]): ApiAnnouncement[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const at = a.notified_at ?? a.publish_at ?? a.created_at
    const bt = b.notified_at ?? b.publish_at ?? b.created_at
    return bt.localeCompare(at)
  })
}
