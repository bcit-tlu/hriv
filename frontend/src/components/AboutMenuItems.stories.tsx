import type { Meta, StoryObj } from '@storybook/react-vite'
import MenuList from '@mui/material/MenuList'
import Paper from '@mui/material/Paper'
import { expect, userEvent, within } from 'storybook/test'
import AboutMenuItems from './AboutMenuItems'

const meta = {
  title: 'Components/AboutMenuItems',
  component: AboutMenuItems,
  args: {
    frontendVersion: '0.67.0',
    backendVersion: '0.52.1',
    backupVersion: '0.9.3',
    onOpenGuide: () => {},
    onNavigate: () => {},
  },
  decorators: [
    (Story) => (
      <Paper sx={{ width: 280 }}>
        <MenuList>
          <Story />
        </MenuList>
      </Paper>
    ),
  ],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof AboutMenuItems>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {}

export const StudentView: Story = {
  name: 'Student (no Documentation)',
  args: { onOpenGuide: undefined },
}

export const AboutDialogOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText('About'))
    await expect(within(document.body).getByText('About HRIV')).toBeInTheDocument()
  },
}
