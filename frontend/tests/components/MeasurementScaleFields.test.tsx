import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MeasurementScaleFields from '../../src/components/MeasurementScaleFields'
import { measurementUnitLabel } from '../../src/measurementUnits'

function renderFields(props: Partial<Parameters<typeof MeasurementScaleFields>[0]> = {}) {
  const onScaleChange = vi.fn()
  const onUnitChange = vi.fn()
  render(
    <MeasurementScaleFields
      scale="7.3"
      unit="um"
      onScaleChange={onScaleChange}
      onUnitChange={onUnitChange}
      {...props}
    />,
  )
  return { onScaleChange, onUnitChange }
}

describe('MeasurementScaleFields', () => {
  it('renders labelled scale and unit fields', () => {
    renderFields({ scaleLabel: 'Scale (px per unit)', unitLabel: 'Unit' })
    expect(screen.getByLabelText('Scale (px per unit)')).toHaveValue(7.3)
    expect(screen.getByLabelText('Unit')).toHaveTextContent('µm')
  })

  it('uses ariaLabel for unlabelled table rows', () => {
    renderFields({ ariaLabel: 'Film A' })
    expect(screen.getByLabelText('Scale for Film A')).toBeInTheDocument()
    expect(screen.getByLabelText('Unit for Film A')).toBeInTheDocument()
  })

  it('reports scale edits', async () => {
    const { onScaleChange } = renderFields({ scale: '', ariaLabel: 'Film A' })
    await userEvent.type(screen.getByLabelText('Scale for Film A'), '2')
    expect(onScaleChange).toHaveBeenLastCalledWith('2')
  })

  it('offers µm, nm, mm and cm', async () => {
    const { onUnitChange } = renderFields({ ariaLabel: 'Film A' })
    await userEvent.click(screen.getByLabelText('Unit for Film A'))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['µm', 'nm', 'mm', 'cm'])
    await userEvent.click(screen.getByRole('option', { name: 'nm' }))
    expect(onUnitChange).toHaveBeenCalledWith('nm')
  })

  it('adds None and keeps a legacy unit when allowed', async () => {
    renderFields({ unit: 'px', unitLabel: 'Unit', allowEmptyUnit: true })
    await userEvent.click(screen.getByLabelText('Unit'))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['None', 'µm', 'nm', 'mm', 'cm', 'px'])
  })
})

describe('measurementUnitLabel', () => {
  it('maps stored values to display labels', () => {
    expect(measurementUnitLabel('um')).toBe('µm')
    expect(measurementUnitLabel('px')).toBe('px')
    expect(measurementUnitLabel(null)).toBe('')
  })
})
