import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FooterBar from '../../src/components/FooterBar'
import { ColorModeContext } from '../../src/colorModeContext'
import type { ColorModeContextValue } from '../../src/colorModeContext'

function renderFooter(
  overrides: Partial<Parameters<typeof FooterBar>[0]> = {},
  colorMode?: Partial<ColorModeContextValue>,
) {
  const setReportIssueOpen =
    overrides.setReportIssueOpen ?? vi.fn()
  const modeValue: ColorModeContextValue = {
    mode: colorMode?.mode ?? 'light',
    preference: colorMode?.preference ?? 'auto',
    setPreference: colorMode?.setPreference ?? vi.fn(),
    toggleMode: colorMode?.toggleMode ?? vi.fn(),
  }
  return {
    setReportIssueOpen,
    ...render(
      <ColorModeContext.Provider value={modeValue}>
        <FooterBar
          canManageUsers={overrides.canManageUsers ?? false}
          frontendVersion={overrides.frontendVersion}
          backendVersion={overrides.backendVersion}
          backupVersion={overrides.backupVersion}
          setReportIssueOpen={setReportIssueOpen}
        />
      </ColorModeContext.Provider>,
    ),
  }
}

describe('FooterBar', () => {
  it('renders BCIT link and license link', () => {
    renderFooter()
    expect(
      screen.getByRole('link', { name: /teaching and learning unit/i }),
    ).toHaveAttribute('href', 'https://www.bcit.ca/learning-teaching-centre/')
    expect(
      screen.getByRole('link', { name: /mpl-2\.0/i }),
    ).toHaveAttribute('href', 'https://www.mozilla.org/en-US/MPL/2.0/')
  })

  it('renders Report issue button and fires callback', async () => {
    const user = userEvent.setup()
    const { setReportIssueOpen } = renderFooter()

    const link = screen.getByText('Report issue')
    await user.click(link)
    expect(setReportIssueOpen).toHaveBeenCalledWith(true)
  })

  it('hides version info when canManageUsers is false', () => {
    renderFooter({ canManageUsers: false, frontendVersion: '1.2.3' })
    expect(screen.queryByText('Frontend:')).not.toBeInTheDocument()
    expect(screen.queryByText('Backend:')).not.toBeInTheDocument()
    expect(screen.queryByText('Backup:')).not.toBeInTheDocument()
  })

  it('shows version info when canManageUsers is true', () => {
    renderFooter({
      canManageUsers: true,
      frontendVersion: '1.2.3',
      backendVersion: '4.5.6',
      backupVersion: '7.8.9',
    })
    expect(screen.getByText('Frontend:')).toBeInTheDocument()
    expect(screen.getByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByText('Backend:')).toBeInTheDocument()
    expect(screen.getByText('4.5.6')).toBeInTheDocument()
    expect(screen.getByText('Backup:')).toBeInTheDocument()
    expect(screen.getByText('7.8.9')).toBeInTheDocument()
  })

  it('shows "dev" when frontendVersion is undefined', () => {
    renderFooter({ canManageUsers: true })
    expect(screen.getByText('dev')).toBeInTheDocument()
  })

  it('shows ellipsis when backendVersion/backupVersion are undefined', () => {
    renderFooter({ canManageUsers: true })
    const ellipses = screen.getAllByText('…')
    expect(ellipses).toHaveLength(2)
  })

  it('links version numbers to releases page when not "dev"', () => {
    renderFooter({
      canManageUsers: true,
      frontendVersion: '1.0.0',
      backendVersion: '2.0.0',
      backupVersion: '3.0.0',
    })
    const releaseLinks = screen.getAllByRole('link').filter(
      (link) => link.getAttribute('href') === 'https://github.com/bcit-tlu/hriv/releases',
    )
    expect(releaseLinks.length).toBe(3)
  })

  it('links "dev" version to repo root instead of releases', () => {
    renderFooter({ canManageUsers: true })
    const devLink = screen.getByText('dev').closest('a')
    expect(devLink).toHaveAttribute(
      'href',
      'https://github.com/bcit-tlu/hriv',
    )
  })

  it('renders in dark mode without errors', () => {
    renderFooter({ canManageUsers: true, frontendVersion: '1.0.0' }, { mode: 'dark' })
    expect(screen.getByText('Frontend:')).toBeInTheDocument()
    expect(screen.getByText('1.0.0')).toBeInTheDocument()
  })
})
