import { Component, type ErrorInfo, type ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'

import { emitFrontendError } from '../observability'

const MAX_DEDUPE_SEGMENT_LENGTH = 160

function normalizeDedupeSegment(value: string | null | undefined): string {
  const collapsed = value?.trim().replace(/\s+/g, ' ')
  if (!collapsed) {
    return 'none'
  }
  if (collapsed.length <= MAX_DEDUPE_SEGMENT_LENGTH) {
    return collapsed
  }
  return `${collapsed.slice(0, MAX_DEDUPE_SEGMENT_LENGTH)}...`
}

function firstComponentFrame(componentStack: string | null | undefined): string {
  const firstFrame = componentStack
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return normalizeDedupeSegment(firstFrame)
}

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
    const errorName = normalizeDedupeSegment(error.name)
    const errorMessage = normalizeDedupeSegment(error.message)
    const componentFrame = firstComponentFrame(errorInfo.componentStack)
    emitFrontendError({
      action: 'render',
      error: error.name === 'Error' ? 'react' : `react_${error.name.toLowerCase()}`,
      errorCode: 'react_render_error',
      dedupeKey: `react_render_error:${errorName}:${errorMessage}:${componentFrame}`,
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
