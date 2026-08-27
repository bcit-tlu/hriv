import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import LoginSplashImage from '../../src/components/LoginSplashImage'

function renderWithTheme(ui: React.ReactElement, mode: 'light' | 'dark' = 'light') {
  const theme = createTheme({ palette: { mode } })
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('LoginSplashImage', () => {
  it('renders a decorative splash container with aria-hidden', () => {
    const { container } = renderWithTheme(<LoginSplashImage />)
    const splash = container.firstChild as HTMLElement
    expect(splash).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses the expected background image', () => {
    const { container } = renderWithTheme(<LoginSplashImage />)
    const splash = container.firstChild as HTMLElement
    expect(splash).toHaveStyle({
      backgroundImage: 'url(/hriv-splash2.jpg)',
    })
  })
})
