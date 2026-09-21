import type { Meta, StoryObj } from '@storybook/react-vite'
import Alert from '@mui/material/Alert'
import ObservabilityErrorBoundary from './ObservabilityErrorBoundary'

// A child that throws on render so the boundary's fallback UI can be captured.
function Boom(): never {
  throw new Error('Storybook: simulated render error')
}

const meta = {
  title: 'Components/ObservabilityErrorBoundary',
  component: ObservabilityErrorBoundary,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Top-level React error boundary. Renders a recoverable error Alert and reports the ' +
          'failure to observability telemetry (deduplicated by error/component frame).',
      },
    },
  },
  // Each story provides children via `render`; default satisfies the type.
  args: { children: null },
} satisfies Meta<typeof ObservabilityErrorBoundary>

export default meta

type Story = StoryObj<typeof meta>

export const Healthy: Story = {
  name: 'Healthy (passes children through)',
  render: () => (
    <ObservabilityErrorBoundary>
      <Alert severity="success">App content renders normally.</Alert>
    </ObservabilityErrorBoundary>
  ),
}

export const Errored: Story = {
  name: 'Errored (fallback UI)',
  render: () => (
    <ObservabilityErrorBoundary>
      <Boom />
    </ObservabilityErrorBoundary>
  ),
}
