import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import MeasurementObjectiveSelect, {
  type MeasurementObjectiveSelectProps,
} from './MeasurementObjectiveSelect'

function Stateful(props: MeasurementObjectiveSelectProps) {
  const [value, setValue] = useState(props.value)
  return <MeasurementObjectiveSelect {...props} value={value} onChange={setValue} />
}

const meta = {
  title: 'Components/MeasurementObjectiveSelect',
  component: MeasurementObjectiveSelect,
  render: (args) => <Stateful {...args} />,
  args: { value: '40', onChange: () => {} },
} satisfies Meta<typeof MeasurementObjectiveSelect>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: { label: 'Objective', helperText: 'Microscope objective magnification' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Objective'))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('option', { name: '×100' }))
    await expect(canvas.getByLabelText('Objective')).toHaveTextContent('×100')
  },
}

export const Empty: Story = {
  args: { label: 'Objective', value: '' },
}

export const TableRow: Story = {
  args: { size: 'small', ariaLabel: 'Blood film ×40' },
}

export const UnusualValue: Story = {
  args: { label: 'Objective', value: '2.5' },
}
