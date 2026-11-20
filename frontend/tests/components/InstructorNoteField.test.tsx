import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import InstructorNoteField from '../../src/components/InstructorNoteField'

describe('InstructorNoteField', () => {
  it('labels the input and shows the visibility hint with a length counter', () => {
    render(<InstructorNoteField value="abc" onChange={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Instructor note' })
    expect(input).toHaveValue('abc')
    expect(input).toHaveAttribute('maxlength', '500')
    expect(screen.getByText('Visible to instructors, staff and admins · 3/500')).toBeInTheDocument()
  })

  it('reports each edit as a plain string', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<InstructorNoteField value="" onChange={onChange} />)

    await user.type(screen.getByRole('textbox', { name: 'Instructor note' }), 'X')

    expect(onChange).toHaveBeenCalledWith('X')
  })
})
