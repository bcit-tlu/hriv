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

/** Reaction pills plus the emoji picker; shared by the card and the banner (#1832). */
export default function AnnouncementReactions({
  announcement: a,
  onToggleReaction,
}: AnnouncementReactionsProps) {
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const entries = Object.entries(a.reactions).filter(([, count]) => count > 0)
  const canReact = Boolean(onToggleReaction) && a.status === 'live'
  if (entries.length === 0 && !canReact) return null

  const closePicker = () => setPickerAnchor(null)
  const pick = (emoji: string) => {
    closePicker()
    onToggleReaction?.(a, emoji)
  }

  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
      {entries.map(([emoji, count]) => {
        const mine = a.my_reactions.includes(emoji)
        return (
          <Chip
            key={emoji}
            size="small"
            label={`${reactionGlyph(emoji)} ${count}`}
            color={mine ? 'primary' : 'default'}
            variant={mine ? 'filled' : 'outlined'}
            aria-pressed={canReact ? mine : undefined}
            aria-label={`${emoji} reaction, ${count}`}
            onClick={canReact ? () => onToggleReaction?.(a, emoji) : undefined}
            clickable={canReact}
          />
        )
      })}
      {canReact && (
        <>
          <Tooltip title="Add reaction">
            <IconButton
              size="small"
              aria-label="Add reaction"
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
                selected={a.my_reactions.includes(reaction.id)}
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
