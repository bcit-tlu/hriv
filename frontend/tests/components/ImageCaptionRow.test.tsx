/**
 * Tests for ImageCaptionRow — the shared title + note + actions caption
 * used by the image view and both collection viewers.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ImageCaptionRow from '../../src/components/ImageCaptionRow'

const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

// The caption clamp is 1 line: it overflows horizontally (scrollWidth).
function stubOverflow() {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => 500,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 100,
  })
}

afterEach(() => {
  for (const [prop, descriptor] of [
    ['scrollWidth', originalScrollWidth],
    ['clientWidth', originalClientWidth],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, prop, descriptor)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
  }
})

describe('ImageCaptionRow', () => {
  it('renders the title as a level-2 heading', () => {
    render(<ImageCaptionRow name="Slice A" onShowNote={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Slice A' })).toBeInTheDocument()
  })

  it('appends an inactive marker', () => {
    render(<ImageCaptionRow name="Slice A" active={false} onShowNote={vi.fn()} />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Slice A (inactive)' }),
    ).toBeInTheDocument()
  })

  it('shows a visible "Notes:" label and the flattened note', () => {
    render(<ImageCaptionRow name="Slice A" note={'Line one.\nLine two.'} onShowNote={vi.fn()} />)
    expect(screen.getByText('Notes:')).toBeInTheDocument()
    expect(screen.getByText('Line one. Line two.')).toBeInTheDocument()
  })

  it('treats a whitespace-only note as absent', () => {
    render(<ImageCaptionRow name="Slice A" note={'  \n  '} onShowNote={vi.fn()} />)
    expect(screen.queryByText(/^Notes:/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveStyle({ flex: '1' })
  })

  it('calls onShowNote from "…more" on overflow', () => {
    stubOverflow()
    const onShowNote = vi.fn()
    render(<ImageCaptionRow name="Slice A" note="A long note" onShowNote={onShowNote} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show full note' }))
    expect(onShowNote).toHaveBeenCalledTimes(1)
  })

  it('renders the end slot after the note', () => {
    render(
      <ImageCaptionRow
        name="Slice A"
        note="A note"
        onShowNote={vi.fn()}
        end={<button>Open image</button>}
      />,
    )
    const noteEl = screen.getByText('A note')
    const endEl = screen.getByRole('button', { name: 'Open image' })
    expect(noteEl.compareDocumentPosition(endEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
