import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api')>()
  return {
    ...actual,
    fetchStatus: vi.fn(),
  }
})

import { fetchStatus } from '../../src/api'
import MaintenanceBanner from '../../src/components/MaintenanceBanner'

describe('MaintenanceBanner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders children when not in maintenance mode', async () => {
    vi.mocked(fetchStatus).mockResolvedValue({ maintenance: false, version: '1.0' })
    render(
      <MaintenanceBanner>
        <div>App Content</div>
      </MaintenanceBanner>,
    )

    await waitFor(() => {
      expect(fetchStatus).toHaveBeenCalled()
    })
    expect(screen.getByText('App Content')).toBeInTheDocument()
  })

  it('renders maintenance message when in maintenance mode', async () => {
    vi.mocked(fetchStatus).mockResolvedValue({ maintenance: true, version: '1.0' })
    render(
      <MaintenanceBanner>
        <div>App Content</div>
      </MaintenanceBanner>,
    )

    await waitFor(() => {
      expect(screen.getByText('Maintenance in Progress')).toBeInTheDocument()
    })
    expect(screen.queryByText('App Content')).toBeNull()
  })

  it('renders children when fetchStatus fails', async () => {
    vi.mocked(fetchStatus).mockRejectedValue(new Error('Network error'))
    render(
      <MaintenanceBanner>
        <div>App Content</div>
      </MaintenanceBanner>,
    )

    await waitFor(() => {
      expect(fetchStatus).toHaveBeenCalled()
    })
    expect(screen.getByText('App Content')).toBeInTheDocument()
  })
})
