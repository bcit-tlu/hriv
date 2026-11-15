import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { AuthContext } from '../authContextValue'
import BoardEditDialog from './BoardEditDialog'
import {
  BOARD_AUTH,
  BOARD_GROUPS,
  BOARD_PROGRAMS,
  BOARDS_FIXTURES,
  installBoardsFetch,
} from './boardsFixtures'

const meta = {
  title: 'Components/BoardEditDialog',
  component: BoardEditDialog,
  args: { onClose: fn(), onSaved: fn(), programs: BOARD_PROGRAMS, groups: BOARD_GROUPS },
  decorators: [
    (Story) => (
      <AuthContext.Provider value={BOARD_AUTH}>
        <Story />
      </AuthContext.Provider>
    ),
  ],
  beforeEach: () => installBoardsFetch(),
} satisfies Meta<typeof BoardEditDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Basic: Story = {}
export const Restricted: Story = {
  args: {
    board: { ...BOARDS_FIXTURES[0], visibility: 'restricted', program_ids: [1], group_ids: [1] },
  },
}
