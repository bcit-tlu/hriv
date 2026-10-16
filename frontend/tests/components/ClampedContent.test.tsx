/**
 * Tests for ClampedContent — the shared line-clamp + "…more" + popover
 * used by ImageViewerInfoBar and the collection-viewer caption rows.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ClampedContent from '../../src/components/ClampedContent'

const defaultProps = {
  popoverHeading: 'Notes',
  moreAriaLabel: 'Show full note',
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

  it('opens a popover with the heading and fullContent on overflow', async () => {
    stubOverflow()
    render(
      <ClampedContent {...defaultProps} fullContent="Full text with newlines">
        Truncated text
      </ClampedContent>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show full note' }))
    const popover = screen.getByRole('presentation')
    expect(within(popover).getByText('Notes')).toBeInTheDocument()
    expect(within(popover).getByText('Full text with newlines')).toBeInTheDocument()

    fireEvent.keyDown(popover, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('presentation')).not.toBeInTheDocument())
  })

  it('falls back to children as the popover body when fullContent is omitted', async () => {
    stubOverflow()
    render(<ClampedContent {...defaultProps}>Full children text</ClampedContent>)

    fireEvent.click(screen.getByRole('button', { name: 'Show full note' }))
    const popover = screen.getByRole('presentation')
    expect(within(popover).getByText('Full children text')).toBeInTheDocument()

    fireEvent.keyDown(popover, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('presentation')).not.toBeInTheDocument())
  })
})
