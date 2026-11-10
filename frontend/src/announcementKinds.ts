import type { SvgIconComponent } from '@mui/icons-material'
import CampaignIcon from '@mui/icons-material/Campaign'
import CelebrationIcon from '@mui/icons-material/Celebration'
import EventIcon from '@mui/icons-material/Event'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { AnnouncementKind, AnnouncementStatus, ApiAnnouncement } from './api'

export type AnnouncementSeverity = 'info' | 'success' | 'warning' | 'error'

export interface AnnouncementKindMeta {
  kind: AnnouncementKind
  label: string
  Icon: SvgIconComponent
  severity: AnnouncementSeverity
  /** Only admins may post this kind (product decision: the icon *is* the kind). */
  adminOnly: boolean
}

/** The controlled icon set — picking an icon picks the kind and its severity. */
export const ANNOUNCEMENT_KINDS: readonly AnnouncementKindMeta[] = [
  { kind: 'notice', label: 'Notice', Icon: CampaignIcon, severity: 'info', adminOnly: false },
  { kind: 'event', label: 'Event', Icon: EventIcon, severity: 'info', adminOnly: false },
  {
    kind: 'reminder',
    label: 'Reminder',
    Icon: NotificationsActiveIcon,
    severity: 'info',
    adminOnly: false,
  },
  {
    kind: 'celebration',
    label: 'Celebration',
    Icon: CelebrationIcon,
    severity: 'success',
    adminOnly: false,
  },
  { kind: 'release', label: 'Release', Icon: RocketLaunchIcon, severity: 'info', adminOnly: true },
  {
    kind: 'warning',
    label: 'Important',
    Icon: WarningAmberIcon,
    severity: 'warning',
    adminOnly: true,
  },
]

export function kindMeta(kind: string): AnnouncementKindMeta {
  return ANNOUNCEMENT_KINDS.find((k) => k.kind === kind) ?? ANNOUNCEMENT_KINDS[0]
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
export function audienceChips(
  a: Pick<ApiAnnouncement, 'audience' | 'program_names' | 'group_names'>,
) {
  if (a.audience === 'everyone') return ['Everyone']
  if (a.audience === 'staff') return ['Staff']
  return [...a.program_names, ...a.group_names]
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
