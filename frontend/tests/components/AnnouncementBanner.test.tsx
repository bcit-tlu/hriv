import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import AnnouncementBanner from '../../src/components/AnnouncementBanner'

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
})
