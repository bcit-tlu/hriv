/**
 * useIsMobile keys the whole mobile layout, so the exact media query matters:
 * the second clause is what keeps a phone on the mobile UI when it's rotated to
 * landscape (width past `sm`, height still phone-sized). Lock the query string
 * so that clause can't be dropped by accident.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useIsMobile } from '../src/useIsMobile'

vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn() }))
const mockUseMediaQuery = vi.mocked(useMediaQuery)

describe('useIsMobile', () => {
  beforeEach(() => mockUseMediaQuery.mockReset())

  it('matches on narrow width OR a touch device with a short height', () => {
    mockUseMediaQuery.mockReturnValue(true)
    const { result } = renderHook(() => useIsMobile())

    // Clause 1 (`max-width`) = portrait phones / narrow viewports (original
    // behaviour). Clause 2 (`pointer: coarse` + `max-height`) = landscape phones.
    expect(mockUseMediaQuery).toHaveBeenCalledWith(
      '(max-width: 599.95px), (pointer: coarse) and (max-height: 599.95px)',
    )
    expect(result.current).toBe(true)
  })

  it('is false when the query does not match (desktop / tablet)', () => {
    mockUseMediaQuery.mockReturnValue(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })
})
