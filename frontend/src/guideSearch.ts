import { GUIDE_PAGES, getGuideMarkdown } from './guideContent'
import { headingSlug, parseGuideMarkdown, type GuideBlock } from './guideMarkdown'

export interface GuideSearchSection {
  /** Doc slug, e.g. "images" */
  slug: string
  /** Anchor for the section's heading; undefined = top of the page. */
  anchor?: string
  /** Page title from the table of contents, e.g. "Managing Images". */
  title: string
  /** The section's own heading text, if it sits under one. */
  heading?: string
  /** Flattened plain-text content of the section. */
  content: string
}

/** Strip inline Markdown so search terms match rendered text. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)\s]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
}

function blocksToText(blocks: GuideBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        parts.push(stripInlineMarkdown(block.text))
        break
      case 'list':
        for (const item of block.items) {
          parts.push(stripInlineMarkdown(item.text))
          for (const sub of item.subItems) parts.push(stripInlineMarkdown(sub))
        }
        break
      case 'code':
        parts.push(block.text)
        break
      case 'image':
        if (block.alt) parts.push(block.alt)
        break
      case 'table':
        for (const row of [block.header, ...block.rows]) {
          for (const cell of row) parts.push(stripInlineMarkdown(cell))
        }
        break
      case 'container':
        if (block.title) parts.push(block.title)
        parts.push(blocksToText(parseGuideMarkdown(block.markdown)))
        break
    }
  }
  return parts.filter(Boolean).join(' ')
}

/**
 * Build the searchable guide index: one entry per heading-delimited section
 * across all guide pages. The page intro (content before the first h2/h3)
 * is indexed as its own entry anchored to the page top.
 */
export function buildGuideIndex(): GuideSearchSection[] {
  const sections: GuideSearchSection[] = []
  for (const { slug, title } of GUIDE_PAGES) {
    const blocks = parseGuideMarkdown(getGuideMarkdown(slug))
    let current: GuideSearchSection = { slug, title, content: '' }
    let currentBlocks: GuideBlock[] = []

    const flush = () => {
      current.content = blocksToText(currentBlocks)
      // The page-top section (no anchor/heading) is emitted even when the
      // page has no intro text, so every page is findable by its title.
      const isPageTop = !current.anchor && !current.heading
      if (isPageTop || current.content.trim()) sections.push(current)
    }

    for (const block of blocks) {
      if (block.type === 'heading' && block.level === 1) {
        // h1 is the page title — the guide UI shows TOC titles, not the h1,
        // and splitting here would orphan intro text in a duplicate section.
        continue
      }
      if (block.type === 'heading') {
        flush()
        current = {
          slug,
          title,
          anchor: headingSlug(block.text),
          heading: block.text,
          content: '',
        }
        // Keep the heading text searchable via the section's content too,
        // so a query matching a heading lands on that section.
        currentBlocks = [{ type: 'paragraph', text: block.text }]
      } else {
        currentBlocks.push(block)
      }
    }
    flush()
  }
  return sections
}
