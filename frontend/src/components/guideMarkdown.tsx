import { type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

import { headingSlug, parseGuideMarkdown } from '../guideMarkdown'

const INLINE_TOKEN_REGEX =
  /(!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g
const LINK_REGEX = /^\[([^\]]+)\]\(([^)\s]+)\)$/
const IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)\s]+)\)$/

interface GuideInlineContext {
  images: Record<string, string>
  onNavigate: (doc: string, anchor?: string) => void
}

function renderInline(text: string, keyPrefix: string, ctx: GuideInlineContext): ReactNode[] {
  const parts = text.split(INLINE_TOKEN_REGEX)
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`

    const imageMatch = part.match(IMAGE_REGEX)
    if (imageMatch) {
      const [, alt, src] = imageMatch
      const url = ctx.images[src.split('/').pop() ?? src]
      return url ? (
        <Box key={key} component="img" src={url} alt={alt} sx={{ maxWidth: 32 }} />
      ) : null
    }

    const linkMatch = part.match(LINK_REGEX)
    if (linkMatch) {
      const [, label, target] = linkMatch
      if (target.startsWith('http://') || target.startsWith('https://')) {
        return (
          <Link key={key} href={target} target="_blank" rel="noopener noreferrer">
            {renderInline(label, `${key}-label`, ctx)}
          </Link>
        )
      }
      // Internal links: "page", "page#anchor", or "#anchor"
      const [doc, anchor] = target.split('#')
      return (
        <Link
          key={key}
          component="button"
          underline="always"
          sx={{ cursor: 'pointer', verticalAlign: 'baseline' }}
          onClick={() => ctx.onNavigate(doc || '', anchor || undefined)}
        >
          {renderInline(label, `${key}-label`, ctx)}
        </Link>
      )
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return <span key={key}>{part}</span>
  })
}

const CONTAINER_SEVERITY: Record<string, 'success' | 'info' | 'warning' | 'error'> = {
  tip: 'success',
  note: 'info',
  info: 'info',
  warning: 'warning',
  important: 'warning',
  caution: 'error',
}

interface GuideMarkdownProps {
  markdown: string
  /** Map of image filename (e.g. "overview.png") to a served URL. */
  images: Record<string, string>
  /** Called for internal page/anchor links: doc slug ("" = current page) plus optional anchor. */
  onNavigate: (doc: string, anchor?: string) => void
}

export default function GuideMarkdown({ markdown, images, onNavigate }: GuideMarkdownProps) {
  const ctx: GuideInlineContext = { images, onNavigate }
  const blocks = parseGuideMarkdown(markdown)

  return (
    <Box
      sx={{
        typography: 'body1',
        '& p': { mt: 0, mb: 2 },
        '& ul': { mt: 0, mb: 2, pl: 3 },
        '& ol': { mt: 0, mb: 2, pl: 3 },
        '& ul ul, & ol ul, & ul ol, & ol ol': { mb: 0 },
        '& li': { mb: 0.75 },
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
          mb: 2,
          p: 1.5,
          borderRadius: 1,
          overflowX: 'auto',
          bgcolor: 'action.hover',
          fontFamily: 'monospace',
          fontSize: '0.85em',
        },
      }}
    >
      {blocks.map((block, index) => {
        const key = `gd-${index}`
        switch (block.type) {
          case 'heading': {
            const variant = block.level === 1 ? 'h4' : block.level === 2 ? 'h5' : 'h6'
            return (
              <Typography
                key={key}
                id={headingSlug(block.text)}
                component={`h${block.level}` as 'h1' | 'h2' | 'h3'}
                variant={variant}
                sx={{ mt: index === 0 ? 0 : 3, mb: 1.5, scrollMarginTop: 16 }}
              >
                {renderInline(block.text, key, ctx)}
              </Typography>
            )
          }
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul'
            return (
              <Box key={key} component={ListTag}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    <Typography component="span" variant="body1">
                      {renderInline(item.text, `${key}-${itemIndex}`, ctx)}
                    </Typography>
                    {item.subItems.length > 0 && (
                      <Box component="ul" sx={{ mt: 0.5, mb: 0 }}>
                        {item.subItems.map((sub, subIndex) => (
                          <li key={`${key}-${itemIndex}-s${subIndex}`}>
                            <Typography component="span" variant="body1">
                              {renderInline(sub, `${key}-${itemIndex}-s${subIndex}`, ctx)}
                            </Typography>
                          </li>
                        ))}
                      </Box>
                    )}
                  </li>
                ))}
              </Box>
            )
          }
          case 'code':
            return (
              <Box key={key} component="pre">
                <code>{block.text}</code>
              </Box>
            )
          case 'image': {
            const url = images[block.src.split('/').pop() ?? block.src]
            if (!url) return null
            return (
              <Box
                key={key}
                component="img"
                src={url}
                alt={block.alt}
                sx={{
                  display: 'block',
                  maxWidth: '100%',
                  height: 'auto',
                  my: 2,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              />
            )
          }
          case 'table':
            return (
              <Table key={key} size="small" sx={{ mb: 2 }}>
                <TableHead>
                  <TableRow>
                    {block.header.map((cell, cellIndex) => (
                      <TableCell key={`${key}-h${cellIndex}`} sx={{ fontWeight: 700 }}>
                        {renderInline(cell, `${key}-h${cellIndex}`, ctx)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {block.rows.map((row, rowIndex) => (
                    <TableRow key={`${key}-r${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <TableCell key={`${key}-r${rowIndex}-c${cellIndex}`}>
                          {renderInline(cell, `${key}-r${rowIndex}-c${cellIndex}`, ctx)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          case 'container':
            return (
              <Alert
                key={key}
                severity={CONTAINER_SEVERITY[block.kind] ?? 'info'}
                icon={false}
                sx={{ mb: 2, '& .MuiAlert-message': { width: '100%' } }}
              >
                {block.title && <AlertTitle>{block.title}</AlertTitle>}
                <GuideMarkdown markdown={block.markdown} images={images} onNavigate={onNavigate} />
              </Alert>
            )
          default:
            return (
              <Typography key={key} component="p" sx={{ whiteSpace: 'pre-wrap' }}>
                {renderInline(block.text, key, ctx)}
              </Typography>
            )
        }
      })}
    </Box>
  )
}
