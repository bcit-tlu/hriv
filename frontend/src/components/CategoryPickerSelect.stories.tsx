import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import CategoryPickerSelect from './CategoryPickerSelect'
import { categoryTree } from './storyFixtures'

const CATEGORIES = categoryTree()

// Stateful wrapper for the controlled value.
function CategoryPickerSelectExample({
  initial,
  includeRoot,
  placeholder,
  excludeCategoryId,
}: {
  initial: number | null
  includeRoot?: boolean
  placeholder?: string
  excludeCategoryId?: number
}) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <Box sx={{ width: 320 }}>
      <CategoryPickerSelect
        categories={CATEGORIES}
        value={value}
        onChange={setValue}
        label="Category"
        includeRoot={includeRoot}
        placeholder={placeholder}
        excludeCategoryId={excludeCategoryId}
      />
    </Box>
  )
}

const meta = {
  title: 'Components/CategoryPickerSelect',
  component: CategoryPickerSelectExample,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Tree-aware category select used across move/edit dialogs. Renders the nested category ' +
          'hierarchy with indentation and can optionally offer a root option and inline add/edit.',
      },
    },
  },
} satisfies Meta<typeof CategoryPickerSelectExample>

export default meta

type Story = StoryObj<typeof meta>

export const Selected: Story = {
  args: { initial: 201 },
}

export const WithRootOption: Story = {
  name: 'With Root Option',
  args: { initial: null, includeRoot: true, placeholder: 'Choose a category…' },
}

export const ExcludingASubtree: Story = {
  name: 'Excluding A Category',
  args: { initial: null, placeholder: 'Choose a destination…', excludeCategoryId: 200 },
}
