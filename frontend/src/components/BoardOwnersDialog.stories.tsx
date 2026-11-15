import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { AuthContext } from '../authContextValue'
import BoardOwnersDialog from './BoardOwnersDialog'
import { BOARD_AUTH, BOARD_PROGRAMS, BOARDS_FIXTURES, installBoardsFetch } from './boardsFixtures'

const meta = {
  title: 'Components/BoardOwnersDialog',
  component: BoardOwnersDialog,
  args: { board: BOARDS_FIXTURES[0], programs: BOARD_PROGRAMS, onClose: fn(), onSaved: fn() },
  decorators: [
    (Story) => (
      <AuthContext.Provider value={BOARD_AUTH}>
        <Story />
      </AuthContext.Provider>
    ),
  ],
  beforeEach: () => installBoardsFetch(),
} satisfies Meta<typeof BoardOwnersDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {}
export const ProgramOwned: Story = {
  args: {
    board: {
      ...BOARDS_FIXTURES[0],
      owner_program_id: 1,
      owners: [{ user_id: null, program_id: 1, name: 'Design', role: null }],
    },
  },
}
