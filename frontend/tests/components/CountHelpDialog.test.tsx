/**
 * CountHelpDialog (#1667): renders the object-counting guide page and closes.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import CountHelpDialog from '../../src/components/CountHelpDialog'

describe('CountHelpDialog', () => {
  it('renders the object-counting guide content', () => {
    render(<CountHelpDialog open onClose={() => {}} />)
    expect(
      screen.getByText('Object counting', { selector: '[id="count-help-title"]' }),
    ).toBeInTheDocument()
    // The guide body is rendered through the guide renderer.
    expect(screen.getAllByText(/rectangle/i).length).toBeGreaterThan(0)
  })

  it('calls onClose from the close button', () => {
    const onClose = vi.fn()
    render(<CountHelpDialog open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }))
    expect(onClose).toHaveBeenCalled()
  })
})
