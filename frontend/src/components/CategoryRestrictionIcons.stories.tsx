import type { Meta, StoryObj } from '@storybook/react-vite'
import Box from '@mui/material/Box'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CategoryRestrictionIcons from './CategoryRestrictionIcons'

interface CategoryRestrictionIconsStoryArgs {
  hasProgramRestriction: boolean
  inheritedProgramRestriction: boolean
  hasGroupRestriction: boolean
  inheritedGroupRestriction: boolean
  hidden: boolean
  clickable: boolean
  label: string
  imageCount: number
}

function CategoryRestrictionIconsExample(args: CategoryRestrictionIconsStoryArgs) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <Typography component="span" color={args.hidden ? 'text.secondary' : 'text.primary'}>
        {args.label}
      </Typography>
      <Typography component="span" color="text.secondary" sx={{ ml: 0.5 }} variant="body2">
        ({args.imageCount})
      </Typography>
      <CategoryRestrictionIcons
        hasGroupRestriction={args.hasGroupRestriction}
        hasProgramRestriction={args.hasProgramRestriction}
        hidden={args.hidden}
        inheritedGroupRestriction={args.inheritedGroupRestriction}
        inheritedProgramRestriction={args.inheritedProgramRestriction}
        onGroupClick={args.clickable ? () => undefined : undefined}
        onProgramClick={args.clickable ? () => undefined : undefined}
      />
    </Box>
  )
}

function ExampleRow({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <Stack spacing={1}>
      <Typography color="text.secondary" variant="overline">
        {title}
      </Typography>
      <Paper sx={{ p: 2 }} variant="outlined">
        {children}
      </Paper>
    </Stack>
  )
}

const meta = {
  title: 'Components/CategoryRestrictionIcons',
  component: CategoryRestrictionIconsExample,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compact lock indicators for category program/group restrictions, including inherited, hidden, and clickable management affordances.',
      },
    },
  },
  argTypes: {
    hasProgramRestriction: {
      control: 'boolean',
      description: 'Show the program restriction lock icon.',
    },
    inheritedProgramRestriction: {
      control: 'boolean',
      description: 'Use the inherited visual treatment and tooltip for the program lock.',
    },
    hasGroupRestriction: {
      control: 'boolean',
      description: 'Show the group restriction lock icon.',
    },
    inheritedGroupRestriction: {
      control: 'boolean',
      description: 'Use the inherited visual treatment and tooltip for the group lock.',
    },
    hidden: {
      control: 'boolean',
      description: 'Use muted hidden-category colour treatment for visible icons.',
    },
    clickable: {
      control: 'boolean',
      description: 'Render icons as MUI IconButton affordances for category management dialogs.',
    },
    label: {
      control: 'text',
      description: 'Story label shown next to the icons to mimic category-picker rows.',
    },
    imageCount: {
      control: { type: 'number', min: 0, max: 99, step: 1 },
      description: 'Story image count shown next to the label.',
    },
  },
  args: {
    hasProgramRestriction: true,
    inheritedProgramRestriction: false,
    hasGroupRestriction: false,
    inheritedGroupRestriction: false,
    hidden: false,
    clickable: false,
    label: 'Architecture',
    imageCount: 12,
  },
} satisfies Meta<typeof CategoryRestrictionIconsExample>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: (args) => <CategoryRestrictionIconsExample {...args} />,
}

export const ProgramRestriction: Story = {
  name: 'Program Restriction',
  args: {
    hasProgramRestriction: true,
    hasGroupRestriction: false,
  },
  render: (args) => <CategoryRestrictionIconsExample {...args} />,
}

export const GroupRestriction: Story = {
  name: 'Group Restriction',
  args: {
    hasProgramRestriction: false,
    hasGroupRestriction: true,
  },
  render: (args) => <CategoryRestrictionIconsExample {...args} />,
}

export const ProgramAndGroupRestrictions: Story = {
  name: 'Program And Group Restrictions',
  args: {
    hasProgramRestriction: true,
    hasGroupRestriction: true,
  },
  render: (args) => <CategoryRestrictionIconsExample {...args} />,
}

export const InheritedRestrictions: Story = {
  name: 'Inherited Restrictions',
  args: {
    hasProgramRestriction: true,
    inheritedProgramRestriction: true,
    hasGroupRestriction: true,
    inheritedGroupRestriction: true,
  },
  render: (args) => <CategoryRestrictionIconsExample {...args} />,
}

export const HiddenCategory: Story = {
  name: 'Hidden Category',
  args: {
    hasProgramRestriction: true,
    hasGroupRestriction: true,
    inheritedGroupRestriction: true,
    hidden: true,
    label: 'Hidden Architecture',
  },
  render: (args) => <CategoryRestrictionIconsExample {...args} />,
}

export const ClickableManagementAffordance: Story = {
  name: 'Clickable Management Affordance',
  args: {
    hasProgramRestriction: true,
    hasGroupRestriction: true,
    clickable: true,
  },
  render: (args) => <CategoryRestrictionIconsExample {...args} />,
}

export const InCategoryPickerRow: Story = {
  name: 'In Category Picker Row',
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => (
    <Paper sx={{ width: 520, maxWidth: '90vw' }} variant="outlined">
      <ListItem>
        <ListItemText>
          <CategoryRestrictionIconsExample
            clickable={false}
            hasGroupRestriction
            hasProgramRestriction
            hidden={false}
            imageCount={12}
            inheritedGroupRestriction={false}
            inheritedProgramRestriction={false}
            label="Architecture"
          />
        </ListItemText>
      </ListItem>
      <ListItem>
        <ListItemText>
          <CategoryRestrictionIconsExample
            clickable={false}
            hasGroupRestriction
            hasProgramRestriction
            hidden={false}
            imageCount={4}
            inheritedGroupRestriction
            inheritedProgramRestriction
            label="└ Italian"
          />
        </ListItemText>
      </ListItem>
      <ListItem>
        <ListItemText>
          <CategoryRestrictionIconsExample
            clickable={false}
            hasGroupRestriction
            hasProgramRestriction
            hidden
            imageCount={0}
            inheritedGroupRestriction
            inheritedProgramRestriction={false}
            label="Hidden archive"
          />
        </ListItemText>
      </ListItem>
    </Paper>
  ),
}

export const StateMatrix: Story = {
  name: 'State Matrix',
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => (
    <Stack spacing={2} sx={{ width: 520, maxWidth: '90vw' }}>
      <ExampleRow title="Direct program">
        <CategoryRestrictionIconsExample
          clickable={false}
          hasGroupRestriction={false}
          hasProgramRestriction
          hidden={false}
          imageCount={12}
          inheritedGroupRestriction={false}
          inheritedProgramRestriction={false}
          label="Program restricted"
        />
      </ExampleRow>
      <ExampleRow title="Direct group">
        <CategoryRestrictionIconsExample
          clickable={false}
          hasGroupRestriction
          hasProgramRestriction={false}
          hidden={false}
          imageCount={6}
          inheritedGroupRestriction={false}
          inheritedProgramRestriction={false}
          label="Group restricted"
        />
      </ExampleRow>
      <ExampleRow title="Inherited program and group">
        <CategoryRestrictionIconsExample
          clickable={false}
          hasGroupRestriction
          hasProgramRestriction
          hidden={false}
          imageCount={4}
          inheritedGroupRestriction
          inheritedProgramRestriction
          label="Inherited restrictions"
        />
      </ExampleRow>
      <ExampleRow title="Hidden with mixed direct/inherited locks">
        <CategoryRestrictionIconsExample
          clickable={false}
          hasGroupRestriction
          hasProgramRestriction
          hidden
          imageCount={0}
          inheritedGroupRestriction
          inheritedProgramRestriction={false}
          label="Hidden category"
        />
      </ExampleRow>
      <ExampleRow title="Clickable management affordance">
        <CategoryRestrictionIconsExample
          clickable
          hasGroupRestriction
          hasProgramRestriction
          hidden={false}
          imageCount={9}
          inheritedGroupRestriction={false}
          inheritedProgramRestriction={false}
          label="Manage restrictions"
        />
      </ExampleRow>
    </Stack>
  ),
}
