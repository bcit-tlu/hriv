import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageMetadataFields from '../../src/components/ImageMetadataFields'
import type { ImageMetadataValues } from '../../src/components/ImageMetadataFields'

const defaultValues: ImageMetadataValues = {
  copyright: '',
  note: '',
  active: true,
}

describe('ImageMetadataFields', () => {
  it('renders all form fields', () => {
    render(
      <ImageMetadataFields
        values={defaultValues}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/copyright/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/active/i)).toBeInTheDocument()
  })

  it('calls onChange when copyright text is entered', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ImageMetadataFields
        values={defaultValues}
        onChange={onChange}
      />,
    )

    const copyrightField = screen.getByLabelText(/copyright/i)
    await user.type(copyrightField, 'A')

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ copyright: 'A' }),
    )
  })

  it('calls onChange when note text is entered', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ImageMetadataFields
        values={defaultValues}
        onChange={onChange}
      />,
    )

    const noteField = screen.getByLabelText(/note/i)
    await user.type(noteField, 'X')
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'X' }),
    )
  })

  it('calls onChange when active toggle is switched', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ImageMetadataFields
        values={defaultValues}
        onChange={onChange}
      />,
    )

    const toggle = screen.getByRole('switch', { name: /active.*visible to students/i })
    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ active: false }),
    )
  })

  it('shows placeholder text for copyright and note', () => {
    render(
      <ImageMetadataFields
        values={defaultValues}
        onChange={vi.fn()}
        copyrightPlaceholder="custom copyright"
        notePlaceholder="custom note"
      />,
    )
    expect(screen.getByPlaceholderText('custom copyright')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('custom note')).toBeInTheDocument()
  })

})
