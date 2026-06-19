import { Fragment, type ReactNode } from 'react'
import Link from '@mui/material/Link'

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; text: string }

const INLINE_TOKEN_REGEX =
  /(\[[^\]]+\]\((?:https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<]+|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
const MARKDOWN_LINK_REGEX = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/

function isSafeHref(href: string) {
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function splitTrailingUrlPunctuation(urlText: string) {
  let href = urlText
  let trailingText = ''

  while (href.length > 0) {
    const lastChar = href.at(-1)
    if (!lastChar) break

    if ('.,!?;:'.includes(lastChar)) {
      trailingText = `${lastChar}${trailingText}`
      href = href.slice(0, -1)
      continue
    }

    if (lastChar === ')') {
      const openParens = (href.match(/\(/g) ?? []).length
      const closeParens = (href.match(/\)/g) ?? []).length
      if (closeParens > openParens) {
        trailingText = `${lastChar}${trailingText}`
        href = href.slice(0, -1)
        continue
      }
    }

    break
  }

  return { href, trailingText }
}

export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_TOKEN_REGEX)
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    const markdownLinkMatch = part.match(MARKDOWN_LINK_REGEX)

    if (markdownLinkMatch) {
      const [, label, href] = markdownLinkMatch
      if (isSafeHref(href)) {
        return (
          <Link
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            color="inherit"
            underline="always"
            sx={{ overflowWrap: 'anywhere' }}
          >
            {renderInline(label, `${key}-label`)}
          </Link>
        )
      }
    }

    if (part.startsWith('http://') || part.startsWith('https://')) {
      const { href, trailingText } = splitTrailingUrlPunctuation(part)
      if (isSafeHref(href)) {
        return (
          <Fragment key={key}>
            <Link
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              color="inherit"
              underline="always"
              sx={{ overflowWrap: 'anywhere' }}
            >
              {href}
            </Link>
            {trailingText}
          </Fragment>
        )
      }
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
    return <Fragment key={key}>{part}</Fragment>
  })
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const paragraphLines: string[] = []
  let listItems: string[] = []
  let codeLines: string[] = []
  let inCodeFence = false

  const flushParagraph = () => {
    const text = paragraphLines.join('\n').trim()
    if (text) {
      blocks.push({ type: 'paragraph', text })
    }
    paragraphLines.length = 0
  }

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'list', items: [...listItems] })
      listItems = []
    }
  }

  const flushCode = () => {
    if (codeLines.length > 0) {
      blocks.push({ type: 'code', text: codeLines.join('\n') })
      codeLines = []
    }
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeFence) {
        flushCode()
        inCodeFence = false
      } else {
        flushParagraph()
        flushList()
        inCodeFence = true
      }
      continue
    }

    if (inCodeFence) {
      codeLines.push(line)
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      })
      continue
    }

    const listMatch = line.match(/^[-*]\s+(.+)$/)
    if (listMatch) {
      flushParagraph()
      listItems.push(listMatch[1].trim())
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    flushList()
    paragraphLines.push(line.trim())
  }

  if (inCodeFence) {
    flushCode()
  }
  flushParagraph()
  flushList()

  return blocks
}
