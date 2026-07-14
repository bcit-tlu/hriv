import { Component, type ErrorInfo, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'

import { emitFrontendError } from '../observability'

interface ObservabilityErrorBoundaryProps {
  children: ReactNode
}

interface ObservabilityErrorBoundaryState {
  hasError: boolean
}

export default class ObservabilityErrorBoundary extends Component<
  ObservabilityErrorBoundaryProps,
  ObservabilityErrorBoundaryState
> {
  state: ObservabilityErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(): ObservabilityErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    emitFrontendError({
      action: 'render',
      error: 'react',
      errorCode: 'react_render_error',
    })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error">
            HRIV ran into an unexpected problem. Refresh the page and try again.
          </Alert>
        </Box>
      )
    }
    return this.props.children
  }
}
