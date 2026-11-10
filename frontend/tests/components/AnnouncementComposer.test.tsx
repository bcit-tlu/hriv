import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as api from '../../src/api'
import AnnouncementComposer from '../../src/components/AnnouncementComposer'
import {
  buildTargetOptions,
  buildUpdatePatch,
  fromLocalInput,
  insertSnippet,
  reconcileTargets,
  toLocalInput,
  type TargetOption,
} from '../../src/announcementUtils'
import { makeAnnouncement } from '../announcementFixtures'

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<typeof api>('../../src/api')
  return {
    ...actual,
    createAnnouncement: vi.fn(),
    updateAnnouncement: vi.fn(),
    uploadMedia: vi.fn(),
  }
})

const mockCreate = vi.mocked(api.createAnnouncement)
const mockUpdate = vi.mocked(api.updateAnnouncement)
const mockUpload = vi.mocked(api.uploadMedia)

const programs = [{ id: 1, name: 'Histotech' }] as api.ApiProgram[]
const groups = [
  { id: 3, name: 'Histology 2026', description: null, instructor_ids: [7], member_ids: [] },
  { id: 4, name: 'Cytology 2026', description: null, instructor_ids: [7], member_ids: [] },
] as unknown as api.ApiGroup[]

function openTo() {
  fireEvent.mouseDown(screen.getByLabelText('To'))
  return screen.getByRole('listbox')
}

function renderComposer(props: Partial<React.ComponentProps<typeof AnnouncementComposer>> = {}) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <AnnouncementComposer
      open
      onClose={onClose}
      onSaved={onSaved}
      isAdmin={false}
      programs={programs}
      groups={groups}
      {...props}
    />,
  )
  return { onSaved, onClose }
}

describe('composer helpers', () => {
  it('round-trips ISO ↔ datetime-local in the local zone', () => {
    const local = toLocalInput('2026-03-02T17:30:00+00:00')
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(fromLocalInput(local)).toBe(new Date('2026-03-02T17:30:00+00:00').toISOString())
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput('garbage')).toBe('')
    expect(fromLocalInput('')).toBeNull()
  })

  it('offers sentinel audiences to admins only, grouped before programs and groups', () => {
    expect(buildTargetOptions(programs, groups, false).map((o) => o.group)).toEqual([
      'Programs',
      'Groups',
      'Groups',
    ])
    expect(buildTargetOptions(programs, groups, true).map((o) => o.label)).toEqual([
      'Everyone',
      'Staff',
      'Histotech',
      'Histology 2026',
      'Cytology 2026',
    ])
  })

  it('inserts snippets on their own paragraph', () => {
    expect(insertSnippet('', 'X', 0, 0)).toBe('X\n')
    expect(insertSnippet('abc', 'X', 3, 3)).toBe('abc\n\nX\n')
    expect(insertSnippet('abc\n', 'X', 4, 4)).toBe('abc\n\nX\n')
    expect(insertSnippet('abc\n\n', 'X', 5, 5)).toBe('abc\n\nX\n')
    expect(insertSnippet('ab', 'X', 1, 1)).toBe('a\n\nX\nb')
  })

  it('keeps sentinel audiences exclusive of targets', () => {
    const [everyone, staff, program, group] = buildTargetOptions(programs, groups, true)
    expect(reconcileTargets([program], [program, everyone])).toEqual([everyone])
    expect(reconcileTargets([everyone], [everyone, group])).toEqual([group])
    expect(reconcileTargets([staff], [staff, program])).toEqual([program])
    expect(reconcileTargets([program], [program, group])).toEqual([program, group])
    const unchanged: TargetOption[] = [program, group]
    expect(reconcileTargets(unchanged, [group])).toEqual([group])
  })
})

describe('AnnouncementComposer', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockUpdate.mockReset()
    mockUpload.mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('hides admin-only kinds and sentinel audiences from instructors', () => {
    renderComposer()
    expect(screen.getByLabelText('Notice')).toBeInTheDocument()
    expect(screen.queryByLabelText('Warning')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Release')).not.toBeInTheDocument()
    const listbox = openTo()
    expect(within(listbox).queryByText('Everyone')).not.toBeInTheDocument()
    expect(within(listbox).getByText('Histotech')).toBeInTheDocument()
    expect(screen.queryByLabelText('Show as banner')).not.toBeInTheDocument()
  })

  it('shows all kinds, Everyone/Staff and the banner toggle to admins', () => {
    renderComposer({ isAdmin: true })
    expect(screen.getByLabelText('Warning')).toBeInTheDocument()
    expect(screen.getByLabelText('Release')).toBeInTheDocument()
    const listbox = openTo()
    expect(within(listbox).getByText('Everyone')).toBeInTheDocument()
    expect(within(listbox).getByText('Staff')).toBeInTheDocument()
    fireEvent.click(screen.getByText('More options'))
    expect(screen.getByLabelText('Show as banner')).toBeInTheDocument()
  })

  it('requires a target for instructors and posts a targeted announcement', async () => {
    const saved = makeAnnouncement({ id: 42 })
    mockCreate.mockResolvedValue(saved)
    const { onSaved, onClose } = renderComposer()
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Quiz Friday' } })
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(screen.getByText('Choose at least one group or program')).toBeInTheDocument()

    fireEvent.click(within(openTo()).getByText('Cytology 2026'))
    fireEvent.click(screen.getByLabelText('Reminder'))
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Study!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(mockCreate).toHaveBeenCalledWith({
      title: 'Quiz Friday',
      message: 'Study!',
      kind: 'reminder',
      audience: 'targeted',
      program_ids: [],
      group_ids: [4],
      publish_at: null,
      expires_at: null,
      draft: false,
      pinned: false,
      banner: false,
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('picking Everyone replaces chosen targets and sends audience=everyone', async () => {
    mockCreate.mockResolvedValue(makeAnnouncement())
    renderComposer({ isAdmin: true })
    fireEvent.click(within(openTo()).getByText('Histotech'))
    fireEvent.click(within(openTo()).getByText('Everyone'))
    expect(screen.queryByText('Histotech', { selector: '.MuiChip-label' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Maintenance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      audience: 'everyone',
      program_ids: [],
      draft: true,
    })
  })

  it('pre-selects the contextual group and converts schedule/expiry to ISO', async () => {
    mockCreate.mockResolvedValue(makeAnnouncement())
    renderComposer({ initialGroupIds: [3] })
    expect(screen.getByText('Histology 2026', { selector: '.MuiChip-label' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Field trip' } })
    fireEvent.click(screen.getByText('More options'))
    fireEvent.change(screen.getByLabelText('Publish at'), { target: { value: '2030-05-01T09:00' } })
    fireEvent.change(screen.getByLabelText('Expires at'), { target: { value: '2030-05-02T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      group_ids: [3],
      publish_at: new Date('2030-05-01T09:00').toISOString(),
      expires_at: new Date('2030-05-02T09:00').toISOString(),
    })
  })

  it('inserts uploaded images as Markdown and videos as bare URLs, then previews with tokens', async () => {
    mockUpload
      .mockResolvedValueOnce({
        id: 12,
        url: '/api/media/12',
        tokenized_url: '/api/media/12?token=abc',
        content_type: 'image/png',
        original_name: 'slide [1].png',
        size: 10,
      } as api.ApiMediaUpload)
      .mockResolvedValueOnce({
        id: 13,
        url: '/api/media/13',
        tokenized_url: '/api/media/13?token=def',
        content_type: 'video/mp4',
        original_name: 'clip.mp4',
        size: 10,
      } as api.ApiMediaUpload)
    renderComposer()
    const input = screen.getByTestId('announcement-media-input')
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'slide [1].png', { type: 'image/png' })] },
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Message')).toHaveValue('![slide 1.png](/api/media/12)\n'),
    )
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'clip.mp4', { type: 'video/mp4' })] },
    })
    await waitFor(() =>
      expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toContain(
        '\n\n/api/media/13\n',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByRole('img', { name: 'slide 1.png' })).toHaveAttribute(
      'src',
      '/api/media/12?token=abc',
    )
    expect(document.querySelector('video source, video')?.getAttribute('src')).toContain(
      'token=def',
    )
  })

  it('surfaces upload failures without losing the message', async () => {
    mockUpload.mockRejectedValue(new api.ApiError(413, 'too big'))
    renderComposer()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'keep me' } })
    fireEvent.change(screen.getByTestId('announcement-media-input'), {
      target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(screen.getByText('too big')).toBeInTheDocument())
    expect(screen.getByLabelText('Message')).toHaveValue('keep me')
  })

  it('edit mode prefills, offers Notify readers again and PATCHes with notify_again', async () => {
    const source = makeAnnouncement({
      id: 9,
      can_edit: true,
      expires_at: '2026-04-01T00:00:00+00:00',
    })
    mockUpdate.mockResolvedValue(source)
    renderComposer({ mode: 'edit', source })
    expect(screen.getByLabelText(/Title/)).toHaveValue('Lab 3 moved to Thursday')
    expect(screen.getByText('Histology 2026', { selector: '.MuiChip-label' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Notify readers again'))
    fireEvent.change(screen.getByLabelText('Expires at'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0][0]).toBe(9)
    expect(mockUpdate.mock.calls[0][1]).toEqual({ notify_again: true, clear_expires_at: true })
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
  })

  it('duplicate mode copies the content but clears the schedule', async () => {
    mockCreate.mockResolvedValue(makeAnnouncement())
    renderComposer({
      mode: 'duplicate',
      source: makeAnnouncement({ publish_at: '2026-01-01T00:00:00+00:00' }),
    })
    expect(screen.getByLabelText(/Title/)).toHaveValue('Lab 3 moved to Thursday (copy)')
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ publish_at: null, group_ids: [3] })
  })

  it('shows the API error when saving fails', async () => {
    mockCreate.mockRejectedValue(
      new api.ApiError(422, 'Instructors must target at least one group or program'),
    )
    renderComposer({ initialGroupIds: [3] })
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.getByText(/Instructors must target/)).toBeInTheDocument())
  })
})

describe('buildUpdatePatch', () => {
  const base = makeAnnouncement({ status: 'live', pinned: false, banner: false })
  const asInput = (a: ReturnType<typeof makeAnnouncement>) => ({
    title: a.title,
    message: a.message,
    kind: a.kind,
    audience: a.audience,
    program_ids: a.program_ids,
    group_ids: a.group_ids,
    publish_at: a.publish_at,
    expires_at: a.expires_at,
    draft: a.publish_at == null,
    pinned: a.pinned,
    banner: a.banner,
  })

  it('sends only the changed fields (a title fix never re-sends targets or kind)', () => {
    expect(buildUpdatePatch(base, { ...asInput(base), title: 'Fixed' })).toEqual({ title: 'Fixed' })
  })

  it('sends audience, programs and groups together when any target changes', () => {
    expect(buildUpdatePatch(base, { ...asInput(base), group_ids: [3, 4] })).toEqual({
      audience: 'targeted',
      program_ids: [],
      group_ids: [3, 4],
    })
  })

  it('publishes a scheduled post now when its schedule is cleared', () => {
    const scheduled = makeAnnouncement({
      status: 'scheduled',
      publish_at: '2031-01-01T00:00:00+00:00',
    })
    const patch = buildUpdatePatch(
      scheduled,
      { ...asInput(scheduled), publish_at: null },
      {
        now: () => '2026-03-10T12:00:00.000Z',
      },
    )
    expect(patch).toEqual({ publish_at: '2026-03-10T12:00:00.000Z' })
  })

  it('leaves a live post alone when the schedule field is empty and flags drafts/expiry/notify', () => {
    expect(buildUpdatePatch(base, { ...asInput(base), publish_at: null })).toEqual({})
    const withExpiry = makeAnnouncement({ expires_at: '2031-01-01T00:00:00+00:00' })
    expect(buildUpdatePatch(withExpiry, { ...asInput(withExpiry), expires_at: null })).toEqual({
      clear_expires_at: true,
    })
    expect(
      buildUpdatePatch(base, { ...asInput(base), draft: true }, { notifyAgain: true }),
    ).toEqual({
      draft: true,
      notify_again: true,
    })
  })
})
