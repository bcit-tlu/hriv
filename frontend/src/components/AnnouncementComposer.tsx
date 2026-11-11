import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  createAnnouncement,
  updateAnnouncement,
  uploadMedia,
  userMessage,
  type AnnouncementAudience,
  type AnnouncementInput,
  type AnnouncementKind,
  type ApiAnnouncement,
  type ApiGroup,
  type ApiProgram,
} from '../api'
import { kindsForRole } from '../announcementKinds'
import {
  buildTargetOptions,
  buildUpdatePatch,
  fromLocalInput,
  initialComposerState,
  insertSnippet,
  reconcileTargets,
  type ComposerMode,
  type TargetOption,
} from '../announcementUtils'
import MarkdownContent from './MarkdownContent'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import {
  PICKER_FORMAT,
  expiryShortcuts,
  publishShortcuts,
  toPickerValue,
} from '../announcementSchedule'

function isVideo(contentType: string): boolean {
  return contentType.startsWith('video/')
}

interface OptionCheckboxProps {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  /** Terse explanation of what the option does for readers. */
  hint: string
}

function OptionCheckbox({ id, checked, onChange, label, hint }: OptionCheckboxProps) {
  const hintId = `${id}-hint`
  return (
    <Box sx={{ minWidth: 0 }}>
      <FormControlLabel
        control={
          <Checkbox
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            slotProps={{ input: { 'aria-describedby': hintId } }}
          />
        }
        label={label}
        sx={{ mr: 0 }}
      />
      <Typography
        id={hintId}
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', ml: 4, mt: -0.75 }}
      >
        {hint}
      </Typography>
    </Box>
  )
}

export interface AnnouncementComposerProps {
  open: boolean
  onClose: () => void
  onSaved: (announcement: ApiAnnouncement) => void
  isAdmin: boolean
  /** Programs/groups the author may target (already scoped to what they manage). */
  programs: ApiProgram[]
  groups: ApiGroup[]
  mode?: ComposerMode
  /** Edit: the post being edited. Duplicate: the source post (publish_at cleared). */
  source?: ApiAnnouncement | null
  /** Contextual compose (e.g. "Post to group"): pre-selected group ids. */
  initialGroupIds?: number[]
}

/** Remounts the form on every open so the fields re-initialise from props. */
export default function AnnouncementComposer(props: AnnouncementComposerProps) {
  if (!props.open) return null
  return <ComposerDialog {...props} />
}

function ComposerDialog({
  onClose,
  onSaved,
  isAdmin,
  programs,
  groups,
  mode = 'create',
  source = null,
  initialGroupIds,
}: AnnouncementComposerProps) {
  const options = useMemo(
    () => buildTargetOptions(programs, groups, isAdmin),
    [programs, groups, isAdmin],
  )
  const kinds = useMemo(() => kindsForRole(isAdmin), [isAdmin])

  const [initial] = useState(() =>
    initialComposerState({ source, mode, options, kinds, isAdmin, initialGroupIds }),
  )
  const [title, setTitle] = useState(initial.title)
  const [message, setMessage] = useState(initial.message)
  const [kind, setKind] = useState<AnnouncementKind>(initial.kind)
  const [targets, setTargets] = useState<TargetOption[]>(initial.targets)
  const [publishAt, setPublishAt] = useState(initial.publishAt)
  const [expiresAt, setExpiresAt] = useState(initial.expiresAt)
  const [pinned, setPinned] = useState(initial.pinned)
  const [banner, setBanner] = useState(initial.banner)
  const [notifyAgain, setNotifyAgain] = useState(false)
  const [moreOpen, setMoreOpen] = useState(initial.moreOpen)
  const [preview, setPreview] = useState(false)
  const [mediaTokens, setMediaTokens] = useState<Record<string, string>>(initial.mediaTokens)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const sentinel = targets.find((o) => o.kind === 'audience')
  const audience: AnnouncementAudience = sentinel?.kind === 'audience' ? sentinel.id : 'targeted'
  const programIds = targets.filter((o) => o.kind === 'program').map((o) => o.id as number)
  const groupIds = targets.filter((o) => o.kind === 'group').map((o) => o.id as number)
  const titleTrimmed = title.trim()
  const targetsValid = audience !== 'targeted' || programIds.length + groupIds.length > 0
  const canSubmit = titleTrimmed.length > 0 && targetsValid && !saving && !uploading
  const isEdit = mode === 'edit' && source != null
  const scheduled = publishAt !== ''

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? message.length
    const end = el?.selectionEnd ?? message.length
    setMessage(insertSnippet(message, snippet, start, end))
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const media = await uploadMedia(file)
      setMediaTokens((prev) => ({
        ...prev,
        [String(media.id)]: media.tokenized_url.split('token=')[1] ?? '',
      }))
      const name = media.original_name.replace(/[[\]]/g, '')
      insertAtCursor(isVideo(media.content_type) ? media.url : `![${name}](${media.url})`)
    } catch (err) {
      setError(userMessage(err, 'Upload failed'))
    } finally {
      setUploading(false)
    }
  }

  const buildInput = (draft: boolean): AnnouncementInput => ({
    title: titleTrimmed,
    message,
    kind,
    audience,
    program_ids: programIds,
    group_ids: groupIds,
    publish_at: fromLocalInput(publishAt),
    expires_at: fromLocalInput(expiresAt),
    draft,
    pinned,
    banner,
  })

  const submit = async (draft: boolean) => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const input = buildInput(draft)
      const saved =
        isEdit && source
          ? await updateAnnouncement(source.id, buildUpdatePatch(source, input, { notifyAgain }))
          : await createAnnouncement(input)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(userMessage(err, 'Could not save announcement'))
    } finally {
      setSaving(false)
    }
  }

  const heading = isEdit ? 'Edit announcement' : 'New announcement'
  const postLabel = isEdit
    ? 'Save'
    : source?.status === 'draft'
      ? 'Post'
      : scheduled
        ? 'Schedule'
        : 'Post'

  return (
    <Dialog
      open
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="announcement-composer-title"
    >
      <DialogTitle id="announcement-composer-title">{heading}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Kind
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={kind}
              onChange={(_e, next: AnnouncementKind | null) => next && setKind(next)}
              aria-label="Announcement kind"
            >
              {kinds.map((k) => (
                <ToggleButton
                  key={k.kind}
                  value={k.kind}
                  aria-label={k.label}
                  sx={{ gap: 0.75, px: 1.5 }}
                >
                  <k.Icon fontSize="small" color={k.severity === 'info' ? 'inherit' : k.severity} />
                  {k.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <Autocomplete
            multiple
            options={options}
            groupBy={(o) => o.group}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.kind === b.kind && a.id === b.id}
            value={targets}
            onChange={(_e, next) => setTargets(reconcileTargets(targets, next))}
            renderValue={(selected, getItemProps) =>
              selected.map((o, index) => (
                <Chip
                  {...getItemProps({ index })}
                  key={`${o.kind}-${o.id}`}
                  size="small"
                  label={o.label}
                  color={o.kind === 'audience' ? 'primary' : 'default'}
                />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="To"
                placeholder={targets.length ? '' : 'Pick groups or programs'}
                error={!targetsValid && titleTrimmed.length > 0}
                helperText={
                  !targetsValid
                    ? 'Choose at least one group or program'
                    : audience === 'everyone'
                      ? 'All signed-in users'
                      : audience === 'targeted'
                        ? ' '
                        : 'Resolved by role — no need to pick programs or groups'
                }
              />
            )}
          />

          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
            slotProps={{ htmlInput: { maxLength: 255 } }}
          />

          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                Message (Markdown)
              </Typography>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
                onChange={handleFile}
                data-testid="announcement-media-input"
              />
              <Tooltip title={uploading ? 'Uploading…' : 'Add image or video'}>
                <span>
                  <IconButton
                    size="small"
                    aria-label="Add image or video"
                    disabled={uploading || preview}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <AddPhotoAlternateOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Button size="small" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
                {preview ? 'Edit' : 'Preview'}
              </Button>
            </Stack>
            {preview ? (
              <Box
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, minHeight: 120 }}
              >
                {message.trim() ? (
                  <MarkdownContent markdown={message} mediaTokens={mediaTokens} />
                ) : (
                  <Typography color="text.secondary">Nothing to preview yet.</Typography>
                )}
              </Box>
            ) : (
              <TextField
                inputRef={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                multiline
                minRows={5}
                fullWidth
                placeholder="What would you like to share?"
                slotProps={{ htmlInput: { 'aria-label': 'Message' } }}
              />
            )}
          </Box>

          <Button
            size="small"
            onClick={() => setMoreOpen((o) => !o)}
            endIcon={<ExpandMoreIcon sx={{ transform: moreOpen ? 'rotate(180deg)' : undefined }} />}
            sx={{ alignSelf: 'flex-start' }}
            aria-expanded={moreOpen}
          >
            More options
          </Button>
          <Collapse in={moreOpen} unmountOnExit>
            <Stack spacing={2}>
              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <DateTimePicker
                    label="Publish at"
                    value={publishAt ? dayjs(publishAt) : null}
                    onChange={(next) => {
                      if (next === null || next.isValid()) setPublishAt(toPickerValue(next))
                    }}
                    format={PICKER_FORMAT}
                    ampm={false}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        helperText: 'Leave empty to post immediately',
                      },
                      field: { clearable: true },
                      shortcuts: { items: publishShortcuts() },
                    }}
                  />
                  <DateTimePicker
                    label="Expires at"
                    value={expiresAt ? dayjs(expiresAt) : null}
                    onChange={(next) => {
                      if (next === null || next.isValid()) setExpiresAt(toPickerValue(next))
                    }}
                    minDateTime={publishAt ? dayjs(publishAt) : undefined}
                    format={PICKER_FORMAT}
                    ampm={false}
                    slotProps={{
                      textField: { fullWidth: true, helperText: 'Optional' },
                      field: { clearable: true },
                      shortcuts: { items: expiryShortcuts(publishAt) },
                    }}
                  />
                </Stack>
              </LocalizationProvider>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexWrap: 'wrap' }}>
                <OptionCheckbox
                  id="announcement-pinned"
                  checked={pinned}
                  onChange={setPinned}
                  label="Pin to top"
                  hint="Stays above newer posts and appears in the Home notices shelf while live"
                />
                {isAdmin && (
                  <OptionCheckbox
                    id="announcement-banner"
                    checked={banner}
                    onChange={setBanner}
                    label="Show as banner"
                    hint="Also shown in a bar at the top of every page until each reader closes it"
                  />
                )}
                {isEdit && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={notifyAgain}
                        onChange={(e) => setNotifyAgain(e.target.checked)}
                      />
                    }
                    label="Notify readers again"
                  />
                )}
              </Stack>
            </Stack>
          </Collapse>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        {(!isEdit || source?.status === 'draft') && (
          <Button onClick={() => void submit(true)} disabled={!canSubmit}>
            Save draft
          </Button>
        )}
        <Button variant="contained" onClick={() => void submit(false)} disabled={!canSubmit}>
          {saving ? 'Saving…' : postLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
