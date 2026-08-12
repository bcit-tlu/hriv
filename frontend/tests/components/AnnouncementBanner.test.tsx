import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import AnnouncementBanner from '../../src/components/AnnouncementBanner'

// Control the mobile/desktop breakpoint. Defaults to desktop (false) so the
// existing suite is unchanged; the mobile block opts in via mockReturnValue.
vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn(() => false) }))

import useMediaQuery from '@mui/material/useMediaQuery'

function renderWithTheme(ui: React.ReactElement, mode: 'light' | 'dark' = 'light') {
  const theme = createTheme({ palette: { mode } })
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    // Default every test to the desktop breakpoint; the mobile block opts in.
    vi.mocked(useMediaQuery).mockReturnValue(false)
  })

  it('renders nothing when message is empty', () => {
    const { container } = renderWithTheme(<AnnouncementBanner message="" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders message in app variant by default', () => {
    renderWithTheme(<AnnouncementBanner message="System update tonight" />)
    expect(screen.getByText('System update tonight')).toBeInTheDocument()
  })

  it('renders message in login variant', () => {
    renderWithTheme(<AnnouncementBanner message="Scheduled maintenance" variant="login" />)
    expect(screen.getByText('Scheduled maintenance')).toBeInTheDocument()
  })

  it('renders dismiss link when onDismiss is provided', () => {
    const onDismiss = vi.fn()
    renderWithTheme(<AnnouncementBanner message="Update tonight" onDismiss={onDismiss} />)
    const link = screen.getByRole('button', { name: 'Dismiss' })
    expect(link).toBeInTheDocument()
    link.click()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not render dismiss link when onDismiss is not provided', () => {
    renderWithTheme(<AnnouncementBanner message="No dismiss" />)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('does not render dismiss link for login variant', () => {
    const onDismiss = vi.fn()
    renderWithTheme(
      <AnnouncementBanner message="Login msg" variant="login" onDismiss={onDismiss} />,
    )
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  })

  it('renders in dark mode without errors', () => {
    renderWithTheme(<AnnouncementBanner message="Dark mode test" />, 'dark')
    expect(screen.getByText('Dark mode test')).toBeInTheDocument()
  })

  it('renders login variant in dark mode', () => {
    renderWithTheme(<AnnouncementBanner message="Dark login" variant="login" />, 'dark')
    expect(screen.getByText('Dark login')).toBeInTheDocument()
  })

  // ─── Mobile app banner (mirrors the login screen treatment) ────────
  describe('app variant on mobile', () => {
    beforeEach(() => {
      vi.mocked(useMediaQuery).mockReturnValue(true)
    })

    it('renders an X close button (not a text "Dismiss" action) when dismissible', () => {
      const onDismiss = vi.fn()
      renderWithTheme(<AnnouncementBanner message="Mobile app msg" onDismiss={onDismiss} />)
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
      const close = screen.getByRole('button', { name: /close/i })
      expect(close).toBeInTheDocument()
      close.click()
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('does not render a close button when onDismiss is not provided', () => {
      renderWithTheme(<AnnouncementBanner message="Mobile app msg" />)
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
      expect(screen.getByText('Mobile app msg')).toBeInTheDocument()
    })
  })
})
