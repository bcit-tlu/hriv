import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import ReorderStatusIndicator from './ReorderStatusIndicator'
import type { TileOrderStatus } from '../tileOrdering'

const meta = {
  title: 'Components/ReorderStatusIndicator',
  component: ReorderStatusIndicator,
  // `padded` gives the filled Alert some breathing room in the snapshot; the
  // component itself is width:100% so it fills whatever container it lands in.
  // Desktop light/dark snapshots come from the global responsiveModes
  // configured in .storybook/preview.tsx — no per-story mode config needed.
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Compact save-state readout for tile reordering (epic #975). Renders as a ' +
          'filled MUI Alert so it can sit inside a Snackbar, with a live region for ' +
          'screen readers and inline recovery actions for conflict/error states.',
      },
    },
  },
  // Spy handlers: every action arg is an `fn()` so play functions can assert the
  // right callback fired, and the Actions panel logs clicks during manual review.
  args: {
    status: 'saving',
    onRetry: fn(),
    onAcceptServerOrder: fn(),
    onReapplyLocalOrder: fn(),
    onRetryFailedScopes: fn(),
  },
  argTypes: {
    status: {
      control: 'select',
      options: [
        'idle',
        'dirty',
        'saving',
        'dirty-while-saving',
        'saved',
        'conflict',
        'error',
      ] satisfies TileOrderStatus[],
      description: 'Reorder lifecycle state driving severity, icon, and available actions.',
    },
    serverOrderAvailable: {
      control: 'boolean',
      description: 'When an error occurs, offer "Use server order" as a recovery path.',
    },
    otherScopesFailed: {
      control: 'boolean',
      description: 'A category other than the browsed one holds an unresolved failed save.',
    },
  },
} satisfies Meta<typeof ReorderStatusIndicator>

export default meta

type Story = StoryObj<typeof meta>

// --- One story per meaningful visual state -------------------------------
// Chromatic can only guard a state that some story actually renders. These map
// 1:1 onto the component's severity/icon branches.

export const Saving: Story = {
  args: { status: 'saving' },
}

export const Saved: Story = {
  args: { status: 'saved' },
}

export const Conflict: Story = {
  args: { status: 'conflict' },
}

export const Error: Story = {
  name: 'Error — With Server Order',
  args: { status: 'error', serverOrderAvailable: true },
}

// `idle` renders nothing on its own; it only surfaces UI via the cross-scope box.
export const CrossScopeFailureOnly: Story = {
  name: 'Cross-Scope Failure (idle)',
  args: { status: 'idle', otherScopesFailed: true },
}

// --- Interaction test: doubles as a play-function assertion --------------
// Runs live in Storybook AND headlessly in Chromium under `npm run test:storybook`.
// A regression that stops wiring the Retry button to onRetry fails this in CI.
export const ErrorRetryFlow: Story = {
  name: 'Error — Retry Flow',
  args: { status: 'error', serverOrderAvailable: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)

    // The live region must be announceable — this is the accessibility contract.
    const alert = canvas.getByRole('status', { name: 'Reorder save state' })
    expect(alert).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))
    expect(args.onRetry).toHaveBeenCalledTimes(1)

    await userEvent.click(canvas.getByRole('button', { name: 'Use server order' }))
    expect(args.onAcceptServerOrder).toHaveBeenCalledTimes(1)
  },
}

// --- State matrix: every state in one snapshot for at-a-glance review ----
// Controls are disabled so the story is a fixed reference the design standard
// is measured against.
export const StateMatrix: Story = {
  name: 'State Matrix',
  parameters: { controls: { disable: true } },
  render: () => {
    const noop = () => undefined
    const states: TileOrderStatus[] = ['saving', 'saved', 'conflict', 'error']
    return (
      <Stack spacing={2} sx={{ width: 420, maxWidth: '90vw' }}>
        {states.map((status) => (
          <Box key={status}>
            <Typography color="text.secondary" variant="overline">
              {status}
            </Typography>
            <ReorderStatusIndicator
              status={status}
              serverOrderAvailable
              onRetry={noop}
              onAcceptServerOrder={noop}
              onReapplyLocalOrder={noop}
            />
          </Box>
        ))}
        <Box>
          <Typography color="text.secondary" variant="overline">
            idle + cross-scope failure
          </Typography>
          <ReorderStatusIndicator
            status="idle"
            otherScopesFailed
            onRetry={noop}
            onAcceptServerOrder={noop}
            onReapplyLocalOrder={noop}
            onRetryFailedScopes={noop}
          />
        </Box>
      </Stack>
    )
  },
}
