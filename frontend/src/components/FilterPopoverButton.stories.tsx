import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import FilterPopoverButton from './FilterPopoverButton'

const meta = {
  title: 'Components/FilterPopoverButton',
  component: FilterPopoverButton,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Chip-style button that opens a popover holding a filter panel. Shows an active-count ' +
          'badge when filters are applied.',
      },
    },
  },
  args: { label: 'Program' },
  argTypes: {
    label: { control: 'text' },
    activeCount: { control: { type: 'number', min: 0, max: 9 } },
  },
} satisfies Meta<typeof FilterPopoverButton>

export default meta

type Story = StoryObj<typeof meta>

const panel = (
  <MenuList>
    <MenuItem>Architecture</MenuItem>
    <MenuItem>Interior Design</MenuItem>
    <MenuItem>Building Engineering</MenuItem>
  </MenuList>
)

export const Default: Story = {
  args: { children: panel },
}

export const WithActiveCount: Story = {
  name: 'With Active Count',
  args: { activeCount: 2, children: panel },
}

export const Opened: Story = {
  name: 'Opened (popover expanded)',
  args: { activeCount: 2, children: panel },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Program/ }))
    // Popover content is portaled to the body, not the canvas root.
    expect(await within(document.body).findByText('Interior Design')).toBeVisible()
  },
}
