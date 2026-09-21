import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import FilterTextPanel from './FilterTextPanel'

// Mobile/desktop × light/dark snapshots come from the global modes in preview.tsx.
const meta = {
  title: 'Components/FilterTextPanel',
  component: FilterTextPanel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Small autofocusing text input used inside filter popovers for free-text ' +
          'narrowing (e.g. filtering a column by substring).',
      },
    },
  },
  args: {
    value: '',
    placeholder: 'Filter…',
    ariaLabel: 'Filter by name',
    onChange: fn(),
  },
  argTypes: {
    value: { control: 'text' },
    placeholder: { control: 'text' },
    helperText: { control: 'text' },
    width: { control: 'text', description: 'Width (number = px, or any CSS length).' },
  },
} satisfies Meta<typeof FilterTextPanel>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithValue: Story = {
  name: 'With Value',
  args: { value: 'architecture' },
}

export const WithHelperText: Story = {
  name: 'With Helper Text',
  args: { value: 'arch', helperText: '3 of 42 categories match' },
}
