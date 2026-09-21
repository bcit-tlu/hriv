import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import FilterOptionPanel from './FilterOptionPanel'

const OPTIONS = [
  { value: 'arch', label: 'Architecture' },
  { value: 'intd', label: 'Interior Design' },
  { value: 'beng', label: 'Building Engineering' },
  { value: 'land', label: 'Landscape' },
]

// Stateful wrapper so selection is interactive; panel is a controlled component.
function FilterOptionPanelExample({
  multiple,
  initial,
  emptyLabel,
}: {
  multiple?: boolean
  initial?: string[]
  emptyLabel?: string
}) {
  const [selected, setSelected] = useState<string[]>(initial ?? [])
  return (
    <Box sx={{ width: 280 }}>
      <FilterOptionPanel
        options={emptyLabel ? [] : OPTIONS}
        selectedValues={selected}
        onChange={setSelected}
        multiple={multiple}
        emptyLabel={emptyLabel}
        searchPlaceholder="Search programs…"
      />
    </Box>
  )
}

const meta = {
  title: 'Components/FilterOptionPanel',
  component: FilterOptionPanelExample,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Searchable option list used inside filter popovers. Supports single or multi-select ' +
          'and a custom empty-state label.',
      },
    },
  },
} satisfies Meta<typeof FilterOptionPanelExample>

export default meta

type Story = StoryObj<typeof meta>

export const MultiSelect: Story = {
  name: 'Multi-select',
  args: { multiple: true, initial: ['arch', 'beng'] },
}

export const SingleSelect: Story = {
  name: 'Single-select',
  args: { multiple: false, initial: ['intd'] },
}

export const NoOptions: Story = {
  name: 'No Options',
  args: { emptyLabel: 'No programs available' },
}
