import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StudentCollectionBadge, {
  STUDENT_CURATED_BADGE_LABEL,
} from '../../src/components/StudentCollectionBadge'

describe('StudentCollectionBadge', () => {
  it('exposes the student-curated label on the informational img role', () => {
    render(<StudentCollectionBadge />)
    // The `CollectionTypeIcon` convention: role="img" + aria-label on the
    // wrapping span, decorative svg aria-hidden inside.
    const badge = screen.getByRole('img', { name: STUDENT_CURATED_BADGE_LABEL })
    expect(badge).toBeInTheDocument()
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('honours the size prop on the svg and keeps the square viewBox', () => {
    render(<StudentCollectionBadge size={32} />)
    const svg = screen.getByRole('img', { name: STUDENT_CURATED_BADGE_LABEL }).querySelector('svg')
    expect(svg).toHaveAttribute('width', '32')
    expect(svg).toHaveAttribute('height', '32')
    expect(svg).toHaveAttribute('viewBox', '0 0 512 512')
  })
})
