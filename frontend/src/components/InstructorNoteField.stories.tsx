import { useState } from 'react'
import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import InstructorNoteField from './InstructorNoteField'
import { MAX_NOTE_LENGTH } from '../constants'

function Stateful(props: ComponentProps<typeof InstructorNoteField>) {
  const [value, setValue] = useState(props.value)
  return <InstructorNoteField {...props} value={value} onChange={setValue} />
}

const meta = {
  title: 'Components/InstructorNoteField',
  component: InstructorNoteField,
  render: (args) => <Stateful {...args} />,
  args: { value: '', onChange: () => {} },
} satisfies Meta<typeof InstructorNoteField>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(`Visible to instructors, staff and admins · 0/${MAX_NOTE_LENGTH}`),
    ).toBeInTheDocument()
    await userEvent.type(canvas.getByRole('textbox', { name: 'Instructor note' }), 'Quiz')
    await expect(
      canvas.getByText(`Visible to instructors, staff and admins · 4/${MAX_NOTE_LENGTH}`),
    ).toBeInTheDocument()
  },
}

export const Filled: Story = {
  args: { value: 'Quiz: identify the glomeruli and the proximal convoluted tubules.' },
}

/** The input stops accepting text at the limit; the field grows up to 10 rows. */
export const AtLimit: Story = {
  args: {
    value: 'Point out the brush border on the proximal tubules. '
      .repeat(10)
      .slice(0, MAX_NOTE_LENGTH),
  },
}
