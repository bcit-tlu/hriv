import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NoteDisplay from '../../src/components/NoteDisplay'

describe('NoteDisplay', () => {
  it('shows full text and no toggle for short note', () => {
    render(<NoteDisplay note={'Short note'} />)
    expect(screen.getByText('Short note')).toBeDefined()
    expect(screen.queryByText(/Show more/i)).toBeNull()
  })

  it('shows Show more for long note and toggles to Show less', () => {
    const long = 'A'.repeat(350)
    render(<NoteDisplay note={long} />)
    const more = screen.getByText(/Show more/i)
    expect(more).toBeDefined()
    fireEvent.click(more)
    expect(screen.getByText(/Show less/i)).toBeDefined()
    expect(screen.getByText(long)).toBeDefined()
  })
})
