import { describe, it, expect } from 'vitest'
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
    renderWithTheme(
      <AnnouncementBanner message="Scheduled maintenance" variant="login" />,
    )
    expect(screen.getByText('Scheduled maintenance')).toBeInTheDocument()
  })

  it('renders in dark mode without errors', () => {
    renderWithTheme(
      <AnnouncementBanner message="Dark mode test" />,
      'dark',
    )
    expect(screen.getByText('Dark mode test')).toBeInTheDocument()
  })

  it('renders login variant in dark mode', () => {
    renderWithTheme(
      <AnnouncementBanner message="Dark login" variant="login" />,
      'dark',
    )
    expect(screen.getByText('Dark login')).toBeInTheDocument()
  })
})
