import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import { MarkdownImage, MediaPlaceholder } from './MarkdownMedia'
import { parseMarkdown, renderInline, resolveMediaSrc, type MediaTokens } from '../markdownUtils'

export interface MarkdownContentProps {
  markdown: string
  /** Per-response `{ mediaId: token }` for `/api/media/{id}` references (announcements). */
  mediaTokens?: MediaTokens
  sx?: SxProps<Theme>
}

export default function MarkdownContent({ markdown, mediaTokens, sx }: MarkdownContentProps) {
  const blocks = parseMarkdown(markdown)
  const inline = (text: string, key: string) => renderInline(text, key, { mediaTokens })

  return (
    <Box
      sx={{
        typography: 'body2',
        '& h1, & h2, & h3': {
          mt: 0,
          mb: 0.75,
          fontWeight: 700,
        },
        '& p': {
          mt: 0,
          mb: 1,
        },
        '& ul': {
          mt: 0,
          mb: 1,
          pl: 3,
        },
        '& li': {
          mb: 0.5,
        },
        '& code': {
          fontFamily: 'monospace',
          bgcolor: 'action.hover',
          borderRadius: 0.5,
          px: 0.5,
          py: 0.1,
          fontSize: '0.9em',
        },
        '& pre': {
          mt: 0,
          mb: 1,
          p: 1.5,
          borderRadius: 1,
          overflowX: 'auto',
          bgcolor: 'action.hover',
          fontFamily: 'monospace',
          fontSize: '0.85em',
        },
        '& img': {
          maxWidth: '100%',
          height: 'auto',
          verticalAlign: 'middle',
          borderRadius: 1,
        },
        '& figure': {
          m: 0,
          mb: 1,
          textAlign: 'center',
        },
        '& figcaption': {
          mt: 0.5,
          color: 'text.secondary',
          fontSize: '0.85em',
        },
        '& video': {
          display: 'block',
          maxWidth: '100%',
          width: '100%',
          maxHeight: 480,
          mb: 1,
          borderRadius: 1,
          bgcolor: 'common.black',
        },
        '& .md-media-missing': {
          display: 'inline-block',
          px: 1,
          py: 0.5,
          borderRadius: 1,
          bgcolor: 'action.hover',
          color: 'text.secondary',
          fontStyle: 'italic',
        },
        ...sx,
      }}
    >
      {blocks.map((block, index) => {
        const key = `md-${index}`
        if (block.type === 'heading') {
          const variant =
            block.level === 1 ? 'subtitle1' : block.level === 2 ? 'subtitle2' : 'body1'
          return (
            <Typography
              key={key}
              component={`h${block.level}` as 'h1' | 'h2' | 'h3'}
              variant={variant}
            >
              {inline(block.text, key)}
            </Typography>
          )
        }
        if (block.type === 'list') {
          return (
            <Box key={key} component="ul">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </Box>
          )
        }
        if (block.type === 'image') {
          const src = resolveMediaSrc(block.src, mediaTokens)
          return (
            <Box key={key} component="figure">
              {src ? (
                <MarkdownImage src={src} alt={block.alt} caption />
              ) : (
                <MediaPlaceholder alt={block.alt} fallback="Image unavailable" />
              )}
            </Box>
          )
        }
        if (block.type === 'video') {
          const src = resolveMediaSrc(block.src, mediaTokens)
          return src ? (
            <video key={key} src={src} controls preload="metadata" />
          ) : (
            <Typography key={key} component="p" variant="body2">
              <span className="md-media-missing">Video unavailable</span>
            </Typography>
          )
        }
        if (block.type === 'code') {
          return (
            <Box key={key} component="pre">
              <code>{block.text}</code>
            </Box>
          )
        }
        return (
          <Typography key={key} component="p" variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {inline(block.text, key)}
          </Typography>
        )
      })}
    </Box>
  )
}
