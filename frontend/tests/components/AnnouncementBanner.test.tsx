import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import AnnouncementBanner from '../../src/components/AnnouncementBanner'

// Control the mobile/desktop breakpoint. Defaults to desktop (false); the
// mobile tests opt in via mockReturnValue(true). Mirrors LoginScreen.test.
vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn(() => false) }))
import useMediaQuery from '@mui/material/useMediaQuery'

function renderWithTheme(ui: React.ReactElement, mode: 'light' | 'dark' = 'light') {
  const theme = createTheme({ palette: { mode } })
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

beforeEach(() => {
  // Default every test to the desktop breakpoint; the mobile block opts in.
  vi.mocked(useMediaQuery).mockReturnValue(false)
})

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

  it('renders in dark mode without errors', () => {
    renderWithTheme(<AnnouncementBanner message="Dark mode test" />, 'dark')
    expect(screen.getByText('Dark mode test')).toBeInTheDocument()
  })

  it('renders login variant in dark mode', () => {
    renderWithTheme(<AnnouncementBanner message="Dark login" variant="login" />, 'dark')
    expect(screen.getByText('Dark login')).toBeInTheDocument()
  })

  // ─── Desktop dismiss: a "Dismiss" text button (app variant only) ────────
  describe('dismiss control on desktop', () => {
    it('app variant shows the "Dismiss" text button (not the X icon)', () => {
      const onDismiss = vi.fn()
      renderWithTheme(<AnnouncementBanner message="Update tonight" onDismiss={onDismiss} />)
      const link = screen.getByRole('button', { name: 'Dismiss' })
      expect(link).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /dismiss announcement/i }),
      ).not.toBeInTheDocument()
      link.click()
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('app variant renders no dismiss control when onDismiss is absent', () => {
      renderWithTheme(<AnnouncementBanner message="No dismiss" />)
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    })

    it('login variant renders no dismiss control (non-dismissible on desktop)', () => {
      const onDismiss = vi.fn()
      renderWithTheme(
        <AnnouncementBanner message="Login msg" variant="login" onDismiss={onDismiss} />,
      )
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /dismiss announcement/i }),
      ).not.toBeInTheDocument()
    })
  })

  // ─── Mobile dismiss: a top-right "X" icon button (both variants) ────────
  describe('dismiss control on mobile', () => {
    beforeEach(() => {
      vi.mocked(useMediaQuery).mockReturnValue(true)
    })

    it('app variant shows the X close icon (not the "Dismiss" text) and calls onDismiss', async () => {
      const onDismiss = vi.fn()
      renderWithTheme(<AnnouncementBanner message="Update tonight" onDismiss={onDismiss} />)
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
      const closeBtn = screen.getByRole('button', { name: /dismiss announcement/i })
      await userEvent.setup().click(closeBtn)
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('login variant shows the X close icon and calls onDismiss', async () => {
      const onDismiss = vi.fn()
      renderWithTheme(
        <AnnouncementBanner message="Login msg" variant="login" onDismiss={onDismiss} />,
      )
      const closeBtn = screen.getByRole('button', { name: /dismiss announcement/i })
      await userEvent.setup().click(closeBtn)
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('renders no dismiss control when onDismiss is absent', () => {
      renderWithTheme(<AnnouncementBanner message="No dismiss" />)
      expect(
        screen.queryByRole('button', { name: /dismiss announcement/i }),
      ).not.toBeInTheDocument()
    })
  })

  // ─── 2-line clamp with More/Less toggle ─────────────────────────────────
  // jsdom reports scrollHeight === clientHeight === 0, so the component never
  // detects overflow on its own. Stub the two layout props on the prototype to
  // simulate text that does / doesn't exceed the 2-line clamp, then restore.
  describe('2-line clamp with More/Less toggle', () => {
    let origScroll: PropertyDescriptor | undefined
    let origClient: PropertyDescriptor | undefined

    function setOverflow(overflowing: boolean) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get() {
          return overflowing ? 60 : 40
        },
      })
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get() {
          return 40
        },
      })
    }

    beforeEach(() => {
      origScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
      origClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    })

    afterEach(() => {
      if (origScroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', origScroll)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
      if (origClient) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origClient)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
    })

    it('renders no toggle when the text fits within 2 lines', () => {
      setOverflow(false)
      renderWithTheme(<AnnouncementBanner message="Short notice" />)
      expect(screen.queryByRole('button', { name: /^(More|Less)$/ })).not.toBeInTheDocument()
    })

    it('renders a "More" toggle when the text overflows 2 lines', () => {
      setOverflow(true)
      renderWithTheme(<AnnouncementBanner message="A very long announcement that overflows" />)
      expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    })

    it('expands to "Less" and collapses back to "More" when toggled', async () => {
      setOverflow(true)
      const user = userEvent.setup()
      renderWithTheme(<AnnouncementBanner message="A very long announcement that overflows" />)

      await user.click(screen.getByRole('button', { name: 'More' }))
      expect(screen.getByRole('button', { name: 'Less' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Less' }))
      expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    })

    it('works in the login variant too', () => {
      setOverflow(true)
      renderWithTheme(<AnnouncementBanner message="A long login notice" variant="login" />)
      expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    })
  })
})
