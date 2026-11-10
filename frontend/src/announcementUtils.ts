import type {
  AnnouncementInput,
  AnnouncementKind,
  AnnouncementUpdateInput,
  ApiAnnouncement,
  ApiGroup,
  ApiProgram,
} from './api'
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

function sameInstant(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a === b
  return new Date(a).getTime() === new Date(b).getTime()
}

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])
}

/**
 * Edit PATCH body: only the fields that differ from `source`, so an instructor
 * who lost one of the post's groups can still fix a typo (the API re-checks
 * authority only for supplied target/kind fields). Clearing the schedule of a
 * not-yet-live post publishes it now; clearing the expiry sends `clear_expires_at`.
 */
export function buildUpdatePatch(
  source: ApiAnnouncement,
  input: AnnouncementInput,
  opts: { notifyAgain?: boolean; now?: () => string } = {},
): AnnouncementUpdateInput {
  const patch: AnnouncementUpdateInput = {}
  if (input.title !== source.title) patch.title = input.title
  if (input.message !== source.message) patch.message = input.message
  if (input.kind !== source.kind) patch.kind = input.kind
  if (
    input.audience !== source.audience ||
    !sameIds(input.program_ids, source.program_ids) ||
    !sameIds(input.group_ids, source.group_ids)
  ) {
    patch.audience = input.audience
    patch.program_ids = input.program_ids
    patch.group_ids = input.group_ids
  }
  if (input.pinned !== source.pinned) patch.pinned = input.pinned
  if (input.banner !== source.banner) patch.banner = input.banner

  const wasDraft = source.publish_at == null
  if (input.draft !== wasDraft) patch.draft = input.draft
  if (!input.draft) {
    if (input.publish_at != null) {
      if (!sameInstant(input.publish_at, source.publish_at)) patch.publish_at = input.publish_at
    } else if (!wasDraft && source.status === 'scheduled') {
      patch.publish_at = (opts.now ?? (() => new Date().toISOString()))()
    }
  }
  if (input.expires_at != null) {
    if (!sameInstant(input.expires_at, source.expires_at)) patch.expires_at = input.expires_at
  } else if (source.expires_at != null) {
    patch.clear_expires_at = true
  }
  if (opts.notifyAgain) patch.notify_again = true
  return patch
}
