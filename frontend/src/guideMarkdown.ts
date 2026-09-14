export type GuideBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'image'; alt: string; src: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'container'; kind: string; title: string; markdown: string }

export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const TABLE_SEPARATOR_REGEX = /^\|?[\s:|-]+\|?$/

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

export function parseGuideMarkdown(markdown: string): GuideBlock[] {
  const blocks: GuideBlock[] = []
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

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

    // ::: kind Optional title — container blocks (tip/warning/important)
    const containerMatch = line.match(/^:::\s*(\w+)\s*(.*)$/)
    if (containerMatch) {
      flushParagraph()
      flushList()
      const [, kind, title] = containerMatch
      const bodyLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith(':::')) {
        bodyLines.push(lines[i])
        i++
      }
      blocks.push({ type: 'container', kind, title: title.trim(), markdown: bodyLines.join('\n') })
      continue
    }

    // GitHub-style table: a header row followed by a --- separator row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR_REGEX.test(lines[i + 1])) {
      flushParagraph()
      flushList()
      const header = splitTableRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      i-- // loop re-checks the current line next iteration
      blocks.push({ type: 'table', header, rows })
      continue
    }

    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)
    if (imageMatch) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'image', alt: imageMatch[1], src: imageMatch[2] })
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
