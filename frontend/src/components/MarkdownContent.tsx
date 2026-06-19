import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import { parseMarkdown, renderInline } from '../markdownUtils'

interface MarkdownContentProps {
  markdown: string
  sx?: SxProps<Theme>
}

export default function MarkdownContent({ markdown, sx }: MarkdownContentProps) {
  const blocks = parseMarkdown(markdown)

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
              {renderInline(block.text, key)}
            </Typography>
          )
        }
        if (block.type === 'list') {
          return (
            <Box key={key} component="ul">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </Box>
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
            {renderInline(block.text, key)}
          </Typography>
        )
      })}
    </Box>
  )
}
