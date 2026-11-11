import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import AnnouncementBanner from '../../src/components/AnnouncementBanner'
import { makeAnnouncement } from '../announcementFixtures'

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
    const link = screen.getByRole('button', { name: 'Close announcement' })
    expect(link).toBeInTheDocument()
    link.click()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not render dismiss link when onDismiss is not provided', () => {
    renderWithTheme(<AnnouncementBanner message="No dismiss" />)
    expect(screen.queryByRole('button', { name: 'Close announcement' })).not.toBeInTheDocument()
  })

  it('does not render dismiss link for login variant', () => {
    const onDismiss = vi.fn()
    renderWithTheme(
      <AnnouncementBanner message="Login msg" variant="login" onDismiss={onDismiss} />,
    )
    expect(screen.queryByRole('button', { name: 'Close announcement' })).not.toBeInTheDocument()
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

describe('AnnouncementBanner (announcements epic)', () => {
  it('shows the title, a "+N more" link and a close button in the app variant', () => {
    const onMore = vi.fn()
    const onDismiss = vi.fn()
    renderWithTheme(
      <AnnouncementBanner
        title="Planned maintenance"
        message="Saturday 06:00"
        severity="warning"
        moreCount={2}
        onMore={onMore}
        onDismiss={onDismiss}
      />,
    )
    expect(screen.getByText('Planned maintenance')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }))
    expect(onMore).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close announcement' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('clamps long bodies behind a More/Less toggle', () => {
    renderWithTheme(<AnnouncementBanner message={'line one\nline two\nline three'} />)
    const toggle = screen.getByRole('button', { name: 'More' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
  })

  it('shows the kind icon and right-aligned reaction pills + picker for a live post', () => {
    const post = makeAnnouncement({ id: 7, kind: 'celebration', reactions: { hooray: 2 } })
    const onToggleReaction = vi.fn()
    renderWithTheme(
      <AnnouncementBanner
        title={post.title}
        message={post.message}
        kind={post.kind}
        announcement={post}
        onToggleReaction={onToggleReaction}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByRole('img', { name: 'Celebration' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'hooray reaction, 2' }))
    expect(onToggleReaction).toHaveBeenCalledWith(post, 'hooray')
    expect(screen.getByRole('button', { name: 'Add reaction' })).toBeInTheDocument()
  })

  it('hides the reaction picker when the banner has no announcement (login broadcast)', () => {
    renderWithTheme(<AnnouncementBanner message="Welcome" kind="notice" variant="login" />)
    expect(screen.getByRole('img', { name: 'Notice' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull()
  })
})
