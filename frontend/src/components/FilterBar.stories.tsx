import type { Meta, StoryObj } from '@storybook/react-vite'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import ClearIcon from '@mui/icons-material/Clear'
import FilterBar from './FilterBar'

// FilterBar is a layout shell filled via props/children (chips, buttons,
// summary). Its horizontal-scroll row behaves differently at mobile vs desktop
// width — exactly what the inherited responsive modes capture.
const meta = {
  title: 'Components/FilterBar',
  component: FilterBar,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Horizontal filter toolbar used above browse/manage tables. Hosts filter controls, ' +
          'an optional clear action, and a wrapping summary row of active-filter chips.',
      },
    },
  },
  // Every story supplies its own children via `render`; this default satisfies
  // the required prop for the type.
  args: { children: null },
} satisfies Meta<typeof FilterBar>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <FilterBar>
      <Chip label="Program" onClick={() => {}} />
      <Chip label="Group" onClick={() => {}} />
      <Chip label="Visibility" onClick={() => {}} />
    </FilterBar>
  ),
}

export const WithActiveFilters: Story = {
  name: 'With Active Filters + Summary',
  render: () => (
    <FilterBar
      clearAction={
        <Button size="small" startIcon={<ClearIcon fontSize="small" />}>
          Clear
        </Button>
      }
      summary={
        <>
          <Chip size="small" label="Program: Architecture" onDelete={() => {}} />
          <Chip size="small" label="Group: Faculty" onDelete={() => {}} />
          <Chip size="small" label='Name contains "north"' onDelete={() => {}} />
        </>
      }
      summaryActions={<Button size="small">Save view</Button>}
    >
      <Chip label="Program" color="primary" onClick={() => {}} />
      <Chip label="Group" color="primary" onClick={() => {}} />
      <Chip label="Visibility" onClick={() => {}} />
    </FilterBar>
  ),
}

export const ManyFiltersOverflow: Story = {
  name: 'Many Filters (overflow scroll)',
  render: () => (
    <FilterBar>
      {['Program', 'Group', 'Visibility', 'Copyright', 'Uploaded', 'Size', 'Type', 'Status'].map(
        (label) => (
          <Chip key={label} label={label} onClick={() => {}} />
        ),
      )}
    </FilterBar>
  ),
}
