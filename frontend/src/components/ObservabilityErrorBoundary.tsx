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

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const componentStack = errorInfo.componentStack?.trim() ?? 'none'
    emitFrontendError({
      action: 'render',
      error: error.name === 'Error' ? 'react' : `react_${error.name.toLowerCase()}`,
      errorCode: 'react_render_error',
      dedupeKey: `react_render_error:${error.name}:${error.message}:${componentStack}`,
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
