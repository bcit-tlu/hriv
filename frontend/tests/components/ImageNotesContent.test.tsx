import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ImageNotesContent from '../../src/components/ImageNotesContent'
import { imageNotesTitle } from '../../src/components/imageNotesTitle'

describe('imageNotesTitle', () => {
  it('names whatever the dialog shows', () => {
    expect(imageNotesTitle('Public', null)).toBe('Description')
    expect(imageNotesTitle('Public', '  ')).toBe('Description')
    expect(imageNotesTitle('Public', 'Staff')).toBe('Description & instructor note')
    expect(imageNotesTitle(null, 'Staff')).toBe('Instructor note')
    expect(imageNotesTitle(null, null)).toBe('Description')
  })
})

describe('ImageNotesContent', () => {
  it('shows only the description, without a heading, when there is no instructor note', () => {
    render(<ImageNotesContent description={'Line one\nLine two'} instructorNote={null} />)

    expect(screen.getByText(/Line one/)).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByText(/instructor/i)).not.toBeInTheDocument()
  })

  it('shows both sections under headings, description first', () => {
    render(<ImageNotesContent description="Public text" instructorNote="Staff text" />)

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Description', 'Instructor note'])
    expect(screen.getByText('Staff text')).toBeInTheDocument()
    expect(screen.getByText('Visible to instructors, staff and admins')).toBeInTheDocument()
  })

  it('shows only the instructor note when the description is blank', () => {
    render(<ImageNotesContent description="  " instructorNote="Staff text" />)

    expect(screen.getByText('Staff text')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
