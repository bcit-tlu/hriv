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

  describe('mobile (compact viewport)', () => {
    beforeEach(() => {
      mockUseMediaQuery.mockReturnValue(true)
    })
    afterEach(() => {
      mockUseMediaQuery.mockReset()
      mockUseMediaQuery.mockReturnValue(false)
    })

    it('renders the "What\'s New" strip with the message and a dismiss button', () => {
      const onDismiss = vi.fn()
      renderWithTheme(<AnnouncementBanner message="ZIP uploads are here" onDismiss={onDismiss} />)
      expect(screen.getByText("What's New")).toBeInTheDocument()
      expect(screen.getByText('ZIP uploads are here')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('toggles the body between clamped (more) and expanded (less)', () => {
      renderWithTheme(<AnnouncementBanner message="Long announcement body" />)
      expect(screen.getByText('more')).toBeInTheDocument()
      fireEvent.click(screen.getByText('more'))
      expect(screen.getByText('less')).toBeInTheDocument()
    })

    it('renders the strip for the login variant too', () => {
      renderWithTheme(<AnnouncementBanner message="Login whats new" variant="login" />)
      expect(screen.getByText("What's New")).toBeInTheDocument()
      expect(screen.getByText('Login whats new')).toBeInTheDocument()
    })
  })
})
