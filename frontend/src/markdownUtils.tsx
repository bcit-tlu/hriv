import { Fragment, type ReactNode } from 'react'
import { MarkdownImage, MediaPlaceholder } from './components/MarkdownMedia'
import Link from '@mui/material/Link'

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'image'; alt: string; src: string }
  | { type: 'video'; src: string }

/** `{ mediaId: token }` minted per response by the announcements API (#1835). */
export type MediaTokens = Record<string, string>

export interface InlineOptions {
  mediaTokens?: MediaTokens
}

const INLINE_TOKEN_REGEX =
  /(!\[[^\]]*\]\([^\s)]+\)|\[[^\]]+\]\((?:https?:\/\/|[/?#])[^\s)]*\)|https?:\/\/[^\s<]+|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
// Absolute http(s) URLs, or in-app links (`/path`, `?page=guide`, `#anchor`) which open in this tab.
const MARKDOWN_LINK_REGEX = /^\[([^\]]+)\]\(((?:https?:\/\/|[/?#])[^\s)]*)\)$/
const MARKDOWN_IMAGE_REGEX = /^!\[([^\]]*)\]\(([^\s)]+)\)$/
const MEDIA_PATH_REGEX = /^\/api\/media\/(\d+)(?:\?[^\s]*)?$/
const VIDEO_URL_REGEX = /^https?:\/\/[^\s]+\.(mp4|webm|mov)(?:\?[^\s]*)?$/i
// Inline raster/SVG data URIs are inert in an <img> context (no script execution).
const DATA_IMAGE_REGEX = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i
const DATA_IMAGE_TYPES: Record<string, string> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
  'svg+xml': 'svg+xml',
}

/**
 * Resolve a Markdown media `src` to something safe to put in `<img>`/`<video>`.
 * `/api/media/{id}` paths need the per-response token; any pasted `?token=`
 * is discarded in favour of the fresh one. External http(s) URLs pass through.
 * Returns `null` when the src is unsafe or its token is missing.
 */
export function resolveMediaSrc(src: string, mediaTokens?: MediaTokens): string | null {
  const mediaMatch = src.match(MEDIA_PATH_REGEX)
  if (mediaMatch) {
    const mediaId = Number(mediaMatch[1])
    const token = mediaTokens?.[String(mediaId)]
    return token ? `/api/media/${mediaId}?token=${encodeURIComponent(token)}` : null
  }
  const dataMatch = src.match(DATA_IMAGE_REGEX)
  if (dataMatch) {
    const type = DATA_IMAGE_TYPES[dataMatch[1].toLowerCase()]
    return type ? `data:image/${type};base64,${dataMatch[2]}` : null
  }
  if (isLocalHref(src) || !isSafeHref(src)) return null
  // Rebuild the URL from its parts so only a normalised http(s) URL reaches the DOM.
  try {
    const url = new URL(src)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const scheme = url.protocol === 'https:' ? 'https://' : 'http://'
    return scheme + url.host + url.pathname + url.search + url.hash
  } catch {
    return null
  }
}

export function isVideoSrc(src: string): boolean {
  return VIDEO_URL_REGEX.test(src)
}

export function isMediaPath(src: string): boolean {
  return MEDIA_PATH_REGEX.test(src)
}

function renderImage(alt: string, src: string, key: string, options?: InlineOptions): ReactNode {
  const resolved = resolveMediaSrc(src, options?.mediaTokens)
  if (!resolved) return <MediaPlaceholder key={key} alt={alt} fallback="Image unavailable" />
  return <MarkdownImage key={key} src={resolved} alt={alt} />
}

/** Same-origin relative link (`/…`, `?…`, `#…`) — never protocol-relative `//host`. */
export function isLocalHref(href: string): boolean {
  return /^(?:\/(?!\/)|[?#])/.test(href)
}

function isSafeHref(href: string) {
  if (isLocalHref(href)) return true
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

export function renderInline(
  text: string,
  keyPrefix: string,
  options?: InlineOptions,
): ReactNode[] {
  const parts = text.split(INLINE_TOKEN_REGEX)
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    const markdownImageMatch = part.match(MARKDOWN_IMAGE_REGEX)
    if (markdownImageMatch) {
      const [, alt, src] = markdownImageMatch
      return renderImage(alt, src, key, options)
    }

    const markdownLinkMatch = part.match(MARKDOWN_LINK_REGEX)

    if (markdownLinkMatch) {
      const [, label, href] = markdownLinkMatch
      if (isSafeHref(href)) {
        const local = isLocalHref(href)
        return (
          <Link
            key={key}
            href={href}
            target={local ? undefined : '_blank'}
            rel={local ? undefined : 'noopener noreferrer'}
            color="inherit"
            underline="always"
            sx={{ overflowWrap: 'anywhere' }}
          >
            {renderInline(label, `${key}-label`, options)}
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
      const imageOnly = text.match(MARKDOWN_IMAGE_REGEX)
      if (imageOnly) {
        blocks.push({ type: 'image', alt: imageOnly[1], src: imageOnly[2] })
      } else if (isMediaPath(text) || isVideoSrc(text)) {
        blocks.push({ type: 'video', src: text })
      } else {
        blocks.push({ type: 'paragraph', text })
      }
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
