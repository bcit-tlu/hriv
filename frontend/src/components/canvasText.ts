/**
 * Wrap canvas text to the same persisted pixel width used by Fabric Textbox.
 * Explicit newlines start a new paragraph; words that exceed the width remain
 * intact, matching Fabric's default dynamicMinWidth behaviour.
 */
export function wrapCanvasText(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = []

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }

    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }

  return lines
}
