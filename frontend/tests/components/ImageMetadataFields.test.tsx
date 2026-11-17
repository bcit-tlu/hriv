import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageMetadataFields from '../../src/components/ImageMetadataFields'
import type { ImageMetadataValues } from '../../src/components/ImageMetadataFields'

const defaultValues: ImageMetadataValues = {
  copyright: '',
  description: '',
  instructorNote: '',
  active: true,
}

describe('ImageMetadataFields', () => {
  it('renders all form fields', () => {
    render(<ImageMetadataFields values={defaultValues} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/copyright/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Instructor note' })).toBeInTheDocument()
    expect(screen.getByLabelText(/visibility/i)).toBeInTheDocument()
  })

  it('calls onChange when copyright text is entered', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ImageMetadataFields values={defaultValues} onChange={onChange} />)

    const copyrightField = screen.getByLabelText(/copyright/i)
    await user.type(copyrightField, 'A')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ copyright: 'A' }))
  })

  it('calls onChange when description text is entered', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ImageMetadataFields values={defaultValues} onChange={onChange} />)

    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'X')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ description: 'X' }))
  })

  it('calls onChange when instructor note text is entered', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ImageMetadataFields values={defaultValues} onChange={onChange} />)

    await user.type(screen.getByRole('textbox', { name: 'Instructor note' }), 'Y')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ instructorNote: 'Y' }))
  })

  it('calls onChange when active toggle is switched', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ImageMetadataFields values={defaultValues} onChange={onChange} />)

    const toggle = screen.getByRole('switch', { name: /visibility.*show image/i })
    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
  })

  it('shows "hide image" when active is false', () => {
    render(<ImageMetadataFields values={{ ...defaultValues, active: false }} onChange={vi.fn()} />)

    expect(screen.getByLabelText(/visibility.*hide image/i)).toBeInTheDocument()
  })

  it('disables visibility when the category is hidden', () => {
    render(<ImageMetadataFields values={defaultValues} onChange={vi.fn()} categoryHidden />)

    expect(screen.getByRole('switch', { name: /visibility.*hidden by category/i })).toBeDisabled()
  })

  it('limits description input to 500 characters and shows a counter', () => {
    render(
      <ImageMetadataFields values={{ ...defaultValues, description: 'abc' }} onChange={vi.fn()} />,
    )

    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute('maxlength', '500')
    expect(screen.getByText('3/500')).toBeInTheDocument()
  })

  it('uses idPrefix for stable field ids', () => {
    render(<ImageMetadataFields values={defaultValues} onChange={vi.fn()} idPrefix="upload" />)

    expect(screen.getByLabelText(/copyright/i)).toHaveAttribute('id', 'upload-copyright')
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute(
      'id',
      'upload-description',
    )
    expect(screen.getByRole('textbox', { name: 'Instructor note' })).toHaveAttribute(
      'id',
      'upload-instructor-note',
    )
    expect(screen.getByRole('switch', { name: /visibility/i })).toHaveAttribute(
      'id',
      'upload-visibility',
    )
  })

  it('shows placeholder text for copyright and description', () => {
    render(
      <ImageMetadataFields
        values={defaultValues}
        onChange={vi.fn()}
        copyrightPlaceholder="custom copyright"
        descriptionPlaceholder="custom description"
      />,
    )
    expect(screen.getByPlaceholderText('custom copyright')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('custom description')).toBeInTheDocument()
  })
})
