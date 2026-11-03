import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import MeasurementScaleFields, { type MeasurementScaleFieldsProps } from './MeasurementScaleFields'

function Stateful(props: Partial<MeasurementScaleFieldsProps>) {
  const [scale, setScale] = useState(props.scale ?? '7.3')
  const [unit, setUnit] = useState(props.unit ?? 'um')
  return (
    <MeasurementScaleFields
      {...props}
      scale={scale}
      unit={unit}
      onScaleChange={setScale}
      onUnitChange={setUnit}
    />
  )
}

const meta = {
  title: 'Components/MeasurementScaleFields',
  component: MeasurementScaleFields,
  render: (args) => <Stateful {...args} />,
  args: {
    scale: '7.3',
    unit: 'um',
    onScaleChange: () => {},
    onUnitChange: () => {},
  },
} satisfies Meta<typeof MeasurementScaleFields>

export default meta
type Story = StoryObj<typeof meta>

export const Dialog: Story = {
  args: {
    scaleLabel: 'Scale (px per unit)',
    unitLabel: 'Unit',
    scaleHelperText: 'Image pixels per real-world unit',
    allowEmptyUnit: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Unit'))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('option', { name: 'mm' }))
    await expect(canvas.getByLabelText('Unit')).toHaveTextContent('mm')
  },
}

export const TableRow: Story = {
  args: { size: 'small', ariaLabel: 'Blood film ×40', placeholder: 'Enter scale' },
}

export const LegacyUnit: Story = {
  args: { scaleLabel: 'Scale (px per unit)', unitLabel: 'Unit', unit: 'px', allowEmptyUnit: true },
}
