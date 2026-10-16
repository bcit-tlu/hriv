/**
 * Tests for ClampedContent — the shared line-clamp + "…more" affordance
 * used by ImageCaptionRow and any clamped link list.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ClampedContent from '../../src/components/ClampedContent'

const defaultProps = {
  moreAriaLabel: 'Show full note',
  onMore: vi.fn(),
}

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

/** Fake vertical overflow: every element measures 100 tall inside a 40 box. */
function stubOverflow() {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 100,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 40,
  })
}

afterEach(() => {
  vi.clearAllMocks()
  for (const [prop, descriptor] of [
    ['scrollHeight', originalScrollHeight],
    ['clientHeight', originalClientHeight],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, prop, descriptor)
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    }
  }
})

describe('ClampedContent', () => {
  it('renders its children', () => {
    render(<ClampedContent {...defaultProps}>A short note</ClampedContent>)
    expect(screen.getByText('A short note')).toBeInTheDocument()
  })

  it('offers no "…more" control when the content fits', () => {
    render(<ClampedContent {...defaultProps}>A short note</ClampedContent>)
    expect(screen.queryByRole('button', { name: 'Show full note' })).not.toBeInTheDocument()
  })

  it('clamps to the requested number of lines', () => {
    render(
      <ClampedContent {...defaultProps} lines={3}>
        Some content
      </ClampedContent>,
    )
    expect(screen.getByText('Some content')).toHaveStyle({
      WebkitLineClamp: '3',
    })
  })

  it('calls onMore from the "…more" link when it overflows', () => {
    stubOverflow()
    const onMore = vi.fn()
    render(
      <ClampedContent {...defaultProps} onMore={onMore}>
        Long content
      </ClampedContent>,
    )

    const more = screen.getByRole('button', { name: 'Show full note' })
    expect(more).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(more)
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it('reflects the caller dialog state on the link', () => {
    stubOverflow()
    render(
      <ClampedContent {...defaultProps} expanded>
        Long content
      </ClampedContent>,
    )
    expect(screen.getByRole('button', { name: 'Show full note' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })
})
