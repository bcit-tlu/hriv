import { useState, type MouseEvent } from 'react'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import AddReactionOutlinedIcon from '@mui/icons-material/AddReactionOutlined'
import type { ApiAnnouncement } from '../api'
import { ANNOUNCEMENT_REACTIONS, reactionGlyph } from '../announcementKinds'

export interface AnnouncementReactionsProps {
  announcement: ApiAnnouncement
  /** Absent (or the post is not live): pills are read-only and the picker is hidden. */
  onToggleReaction?: (announcement: ApiAnnouncement, emoji: string) => void
}

/**
 * Reaction pills plus the emoji picker (Announcements page only, #1832).
 * One reaction per reader: the picker shows until they pick one; their own pill is outlined in the
 * brand colour and pressing it withdraws the reaction (the picker returns). Other readers' pills
 * are counts only.
 */
export default function AnnouncementReactions({
  announcement: a,
  onToggleReaction,
}: AnnouncementReactionsProps) {
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const entries = Object.entries(a.reactions).filter(([, count]) => count > 0)
  const canReact = Boolean(onToggleReaction) && a.status === 'live'
  const myEmoji = a.my_reactions[0]
  const showPicker = canReact && myEmoji == null
  if (entries.length === 0 && !showPicker) return null

  const closePicker = () => setPickerAnchor(null)
  const pick = (emoji: string) => {
    closePicker()
    onToggleReaction?.(a, emoji)
  }

  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
      {entries.map(([emoji, count]) => {
        const mine = emoji === myEmoji
        const clickable = canReact && mine
        return (
          <Chip
            key={emoji}
            size="small"
            variant="outlined"
            color="default"
            label={`${reactionGlyph(emoji)} ${count}`}
            aria-pressed={clickable ? true : undefined}
            aria-label={
              mine
                ? `${emoji} reaction, ${count}, yours — press to withdraw`
                : `${emoji} reaction, ${count}`
            }
            onClick={clickable ? () => onToggleReaction?.(a, emoji) : undefined}
            clickable={clickable}
            // Own pill: same soft grey as the picker, just bolder — no brand-colour outline.
            sx={mine ? { fontWeight: 600, borderColor: 'text.disabled' } : undefined}
          />
        )
      })}
      {showPicker && (
        <>
          <Tooltip title="Add reaction">
            <IconButton
              size="small"
              aria-label="Add reaction"
              sx={{ color: 'text.disabled' }}
              onClick={(event: MouseEvent<HTMLElement>) => setPickerAnchor(event.currentTarget)}
            >
              <AddReactionOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={pickerAnchor}
            open={Boolean(pickerAnchor)}
            onClose={closePicker}
            slotProps={{
              list: { sx: { display: 'flex', flexWrap: 'wrap', maxWidth: 200, p: 0.5 } },
            }}
          >
            {ANNOUNCEMENT_REACTIONS.map((reaction) => (
              <MenuItem
                key={reaction.id}
                aria-label={reaction.label}
                onClick={() => pick(reaction.id)}
                sx={{ px: 1, fontSize: '1.2rem', borderRadius: 1 }}
              >
                {reaction.glyph}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Stack>
  )
}
