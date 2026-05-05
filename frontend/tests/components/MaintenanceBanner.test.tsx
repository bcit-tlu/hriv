/**
 * Unit tests for the MaintenanceBanner component.
 *
 * Covers:
 * 1. Children render when not in maintenance mode
 * 2. Maintenance overlay shown when backend reports maintenance=true
 * 3. Children hidden during maintenance
 * 4. Graceful fallback when fetchStatus fails (children shown)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MaintenanceBanner from '../../src/components/MaintenanceBanner'

vi.mock('../../src/api', () => ({
  fetchStatus: vi.fn(),
}))

import { fetchStatus } from '../../src/api'

const mockedFetchStatus = vi.mocked(fetchStatus)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MaintenanceBanner', () => {
  it('renders children when not in maintenance', async () => {
    mockedFetchStatus.mockResolvedValue({ maintenance: false, version: 'dev' })

    render(
      <MaintenanceBanner>
        <div data-testid="child">Hello</div>
      </MaintenanceBanner>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument()
    })
    expect(screen.queryByText('Maintenance in Progress')).not.toBeInTheDocument()
  })

  it('shows maintenance overlay when maintenance is true', async () => {
    mockedFetchStatus.mockResolvedValue({ maintenance: true, version: 'dev' })

    render(
      <MaintenanceBanner>
        <div data-testid="child">Hello</div>
      </MaintenanceBanner>,
    )

    await waitFor(() => {
      expect(screen.getByText('Maintenance in Progress')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('renders children when fetchStatus fails', async () => {
    mockedFetchStatus.mockRejectedValue(new Error('Network error'))

    render(
      <MaintenanceBanner>
        <div data-testid="child">Hello</div>
      </MaintenanceBanner>,
    )

    // Children should be visible since we default to non-maintenance on error
    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument()
    })
    expect(screen.queryByText('Maintenance in Progress')).not.toBeInTheDocument()
  })
})
