import type { AnnouncementKind, ApiAnnouncement, ApiGroup, ApiProgram } from './api'
import type { AnnouncementKindMeta } from './announcementKinds'
import { formatRelativeTime } from './formatUtils'

export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

export function announcementTimeLabel(a: ApiAnnouncement, now = new Date()): string {
  if (a.status === 'draft') return 'Draft'
  if (a.status === 'scheduled' && a.publish_at)
    return `Scheduled for ${formatAbsolute(a.publish_at)}`
  if (a.status === 'expired' && a.expires_at)
    return `Expired ${formatRelativeTime(a.expires_at, now)}`
  const when = a.notified_at ?? a.publish_at ?? a.created_at
  return formatRelativeTime(when, now)
}

export type TargetOption =
  | { kind: 'everyone'; id: 'everyone'; label: 'Everyone'; group: 'Audience' }
  | { kind: 'staff'; id: 'staff'; label: 'Staff'; group: 'Audience' }
  | { kind: 'program'; id: number; label: string; group: 'Programs' }
  | { kind: 'group'; id: number; label: string; group: 'Groups' }

export type ComposerMode = 'create' | 'edit' | 'duplicate'

/** ISO timestamp → `datetime-local` input value in the browser's zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `datetime-local` input value (local zone) → ISO UTC, or null when empty/invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function buildTargetOptions(
  programs: ApiProgram[],
  groups: ApiGroup[],
  isAdmin: boolean,
): TargetOption[] {
  const options: TargetOption[] = []
  if (isAdmin) {
    options.push({ kind: 'everyone', id: 'everyone', label: 'Everyone', group: 'Audience' })
    options.push({ kind: 'staff', id: 'staff', label: 'Staff', group: 'Audience' })
  }
  for (const p of programs)
    options.push({ kind: 'program', id: p.id, label: p.name, group: 'Programs' })
  for (const g of groups) options.push({ kind: 'group', id: g.id, label: g.name, group: 'Groups' })
  return options
}

/** Sentinel audiences are exclusive: picking one clears everything else and vice versa. */
export function reconcileTargets(previous: TargetOption[], next: TargetOption[]): TargetOption[] {
  const added = next.find((o) => !previous.includes(o))
  if (!added) return next
  if (added.kind === 'everyone' || added.kind === 'staff') return [added]
  return next.filter((o) => o.kind !== 'everyone' && o.kind !== 'staff')
}

export interface ComposerInitialState {
  title: string
  message: string
  kind: AnnouncementKind
  targets: TargetOption[]
  publishAt: string
  expiresAt: string
  pinned: boolean
  banner: boolean
  moreOpen: boolean
  mediaTokens: Record<string, string>
}

/** Form state when the composer opens: edit/duplicate prefill, or a blank post with any contextual group. */
export function initialComposerState(args: {
  source: ApiAnnouncement | null
  mode: ComposerMode
  options: TargetOption[]
  kinds: AnnouncementKindMeta[]
  isAdmin: boolean
  initialGroupIds?: number[]
}): ComposerInitialState {
  const { source, mode, options, kinds, isAdmin, initialGroupIds } = args
  if (source) {
    const duplicate = mode === 'duplicate'
    return {
      title: duplicate ? `${source.title} (copy)` : source.title,
      message: source.message,
      kind: kinds.some((k) => k.kind === source.kind) ? source.kind : 'notice',
      targets: options.filter((o) => {
        if (o.kind === 'everyone') return source.audience === 'everyone'
        if (o.kind === 'staff') return source.audience === 'staff'
        if (o.kind === 'program') return source.program_ids.includes(o.id)
        return source.group_ids.includes(o.id)
      }),
      publishAt: duplicate ? '' : toLocalInput(source.publish_at),
      expiresAt: duplicate ? '' : toLocalInput(source.expires_at),
      pinned: source.pinned,
      banner: source.banner,
      moreOpen: Boolean(source.expires_at || source.pinned || source.banner),
      mediaTokens: source.media_tokens ?? {},
    }
  }
  const groupOptions = options.filter((o) => o.kind === 'group')
  const preselected = groupOptions.filter((o) => initialGroupIds?.includes(o.id as number) ?? false)
  const soleManagedGroup =
    !isAdmin && groupOptions.length === 1 && !options.some((o) => o.kind === 'program')
  return {
    title: '',
    message: '',
    kind: 'notice',
    targets: preselected.length > 0 ? preselected : soleManagedGroup ? groupOptions : [],
    publishAt: '',
    expiresAt: '',
    pinned: false,
    banner: false,
    moreOpen: false,
    mediaTokens: {},
  }
}

/** Insert a standalone media snippet at the cursor on its own paragraph. */
export function insertSnippet(
  message: string,
  snippet: string,
  start: number,
  end: number,
): string {
  const before = message.slice(0, start)
  const after = message.slice(end)
  const sep =
    before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  return `${before}${sep}${snippet}\n${after}`
}
