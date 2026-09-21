import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import type { MoveRestrictionChange } from '../categoryUtils'
import type { Group, Program } from '../types'
import MoveRestrictionConfirmDialog from './MoveRestrictionConfirmDialog'

const PROGRAMS = [
  { id: 1, name: 'Architecture' },
  { id: 2, name: 'Interior Design' },
] as unknown as Program[]

const GROUPS = [
  { id: 10, name: 'Faculty' },
  { id: 11, name: 'Students' },
] as unknown as Group[]

function change(overrides: Partial<MoveRestrictionChange>): MoveRestrictionChange {
  return {
    hasChange: true,
    oldEffectiveProgramIds: [],
    oldProgramsInitialized: false,
    newEffectiveProgramIds: [],
    newProgramsInitialized: false,
    oldEffectiveGroupIds: [],
    oldGroupsInitialized: false,
    newEffectiveGroupIds: [],
    newGroupsInitialized: false,
    ...overrides,
  }
}

// Dialogs render fullscreen on the mobile viewport; the inherited responsive
// modes capture both sizes.
const meta = {
  title: 'Components/MoveRestrictionConfirmDialog',
  component: MoveRestrictionConfirmDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Confirmation shown before a category move that would change effective access ' +
          'restrictions, previewing the before/after program and group scoping.',
      },
    },
  },
  args: {
    open: true,
    categoryLabel: 'Italian Renaissance',
    destinationLabel: 'Public Archive',
    programs: PROGRAMS,
    groups: GROUPS,
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof MoveRestrictionConfirmDialog>

export default meta

type Story = StoryObj<typeof meta>

export const ProgramRestrictionAdded: Story = {
  name: 'Program Restriction Added',
  args: {
    change: change({
      newEffectiveProgramIds: [1],
      newProgramsInitialized: true,
    }),
  },
}

export const ProgramAndGroupChange: Story = {
  name: 'Program And Group Change',
  args: {
    change: change({
      oldEffectiveProgramIds: [1, 2],
      oldProgramsInitialized: true,
      newEffectiveProgramIds: [1],
      newProgramsInitialized: true,
      newEffectiveGroupIds: [10],
      newGroupsInitialized: true,
    }),
  },
}

export const NoEffectiveChange: Story = {
  name: 'No Effective Change',
  args: {
    change: change({ hasChange: false }),
  },
}
