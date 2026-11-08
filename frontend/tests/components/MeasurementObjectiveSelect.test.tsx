import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MeasurementObjectiveSelect from '../../src/components/MeasurementObjectiveSelect'

describe('MeasurementObjectiveSelect', () => {
  it('lists None and the common objectives and reports the pick', async () => {
    const onChange = vi.fn()
    render(<MeasurementObjectiveSelect label="Objective" value="40" onChange={onChange} />)
    const select = screen.getByLabelText('Objective')
    expect(select).toHaveTextContent('×40')
    await userEvent.click(select)
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['None', '×4', '×10', '×20', '×40', '×50', '×60', '×100'])
    await userEvent.click(screen.getByRole('option', { name: '×100' }))
    expect(onChange).toHaveBeenCalledWith('100')
  })

  it('reports an empty string for None', async () => {
    const onChange = vi.fn()
    render(<MeasurementObjectiveSelect label="Objective" value="10" onChange={onChange} />)
    await userEvent.click(screen.getByLabelText('Objective'))
    await userEvent.click(screen.getByRole('option', { name: 'None' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('keeps an unusual stored objective selectable', async () => {
    render(<MeasurementObjectiveSelect label="Objective" value="2.5" onChange={() => {}} />)
    const select = screen.getByLabelText('Objective')
    expect(select).toHaveTextContent('×2.5')
    await userEvent.click(select)
    expect(screen.getByRole('option', { name: '×2.5' })).toBeInTheDocument()
  })

  it('names unlabelled table-row pickers after the image', () => {
    render(
      <MeasurementObjectiveSelect size="small" ariaLabel="Film A" value="" onChange={() => {}} />,
    )
    expect(screen.getByLabelText('Objective for Film A')).toHaveTextContent('None')
  })
})
