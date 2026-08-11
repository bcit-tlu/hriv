import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import AnnouncementBanner from '../../src/components/AnnouncementBanner'

vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn(() => false) }))
const mockUseMediaQuery = vi.mocked(useMediaQuery)

function renderWithTheme(ui: React.ReactElement, mode: 'light' | 'dark' = 'light') {
  const theme = createTheme({ palette: { mode } })
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('AnnouncementBanner', () => {
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

  // The login screen follows the mobile design language at every width, so the
  // login variant renders the compact info strip (info icon + message, with its
  // own dismiss control) rather than the desktop filled Alert.
  it('renders the compact strip for the login variant even on desktop', () => {
    const onDismiss = vi.fn()
    renderWithTheme(
      <AnnouncementBanner message="Login msg" variant="login" onDismiss={onDismiss} />,
    )
    // The info icon is the strip's sole "What's New" indicator (no text label).
    expect(screen.getByTestId('InfoOutlinedIcon')).toBeInTheDocument()
    expect(screen.getByText('Login msg')).toBeInTheDocument()
    // Compact strip, not the desktop filled Alert.
    expect(document.querySelector('.MuiAlert-root')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps the filled Alert for the app variant on desktop', () => {
    renderWithTheme(<AnnouncementBanner message="App msg" variant="app" />)
    expect(screen.getByText('App msg')).toBeInTheDocument()
    // App variant renders the desktop filled Alert, not the compact strip.
    expect(document.querySelector('.MuiAlert-root')).not.toBeNull()
  })

  it('renders in dark mode without errors', () => {
    renderWithTheme(<AnnouncementBanner message="Dark mode test" />, 'dark')
    expect(screen.getByText('Dark mode test')).toBeInTheDocument()
  })

  it('renders login variant in dark mode', () => {
    renderWithTheme(<AnnouncementBanner message="Dark login" variant="login" />, 'dark')
    expect(screen.getByText('Dark login')).toBeInTheDocument()
  })

  describe('mobile (compact viewport)', () => {
    beforeEach(() => {
      mockUseMediaQuery.mockReturnValue(true)
    })
    afterEach(() => {
      vi.restoreAllMocks()
      mockUseMediaQuery.mockReset()
      mockUseMediaQuery.mockReturnValue(false)
    })

    it('renders the info strip with the message and a dismiss button', () => {
      const onDismiss = vi.fn()
      renderWithTheme(<AnnouncementBanner message="ZIP uploads are here" onDismiss={onDismiss} />)
      // The info icon is the strip's indicator (no "What's New" text label).
      expect(screen.getByTestId('InfoOutlinedIcon')).toBeInTheDocument()
      expect(screen.getByText('ZIP uploads are here')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    // jsdom has no layout engine, so the clamp overflow has to be simulated:
    // scrollHeight > clientHeight is what marks the body as truncated.
    function stubOverflow(overflowing: boolean) {
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(overflowing ? 40 : 20)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(20)
    }

    it('toggles the body between clamped (more) and expanded (less)', () => {
      stubOverflow(true)
      renderWithTheme(<AnnouncementBanner message="Long announcement body" />)
      expect(screen.getByText('more')).toBeInTheDocument()
      fireEvent.click(screen.getByText('more'))
      expect(screen.getByText('less')).toBeInTheDocument()
    })

    it('keeps the less toggle available once expanded', () => {
      stubOverflow(true)
      renderWithTheme(<AnnouncementBanner message="Long announcement body" />)
      fireEvent.click(screen.getByText('more'))
      // Expanded text always fits, so the toggle must not vanish mid-read.
      expect(screen.getByText('less')).toBeInTheDocument()
      fireEvent.click(screen.getByText('less'))
      expect(screen.getByText('more')).toBeInTheDocument()
    })

    it('omits the more toggle when the message is short enough to fit', () => {
      stubOverflow(false)
      renderWithTheme(<AnnouncementBanner message="Short" />)
      expect(screen.getByText('Short')).toBeInTheDocument()
      expect(screen.queryByText('more')).not.toBeInTheDocument()
      expect(screen.queryByText('less')).not.toBeInTheDocument()
    })

    it('renders the strip for the login variant too', () => {
      renderWithTheme(<AnnouncementBanner message="Login whats new" variant="login" />)
      expect(screen.getByTestId('InfoOutlinedIcon')).toBeInTheDocument()
      expect(screen.getByText('Login whats new')).toBeInTheDocument()
    })
  })
})
