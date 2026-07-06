import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AppShell from '../../src/components/AppShell'
import type { AppShellProps } from '../../src/components/AppShell'
import { createRef } from 'react'
import useMediaQuery from '@mui/material/useMediaQuery'

vi.mock('@mui/material/useMediaQuery', () => ({ default: vi.fn(() => false) }))
const mockUseMediaQuery = vi.mocked(useMediaQuery)

function makeProps(overrides: Partial<AppShellProps> = {}): AppShellProps {
  return {
    page: 'browse',
    onTabChange: vi.fn(),
    onHomeClick: vi.fn(),
    canEditContent: true,
    canManageUsers: true,
    currentUser: {
      name: 'Test User',
      email: 'test@example.com',
      role: 'admin',
      program_names: [],
      group_names: [],
    },
    announcement: '',
    annMessage: '',
    annEnabled: false,
    profileOpen: false,
    setProfileOpen: vi.fn(),
    avatarRef: createRef<HTMLButtonElement>(),
    openEditProfile: vi.fn(),
    logout: vi.fn(),
    onOpenCategories: vi.fn(),
    onOpenPrograms: vi.fn(),
    onOpenGroups: vi.fn(),
    onOpenAnnouncement: vi.fn(),
    onSearchOpen: vi.fn(),
    mode: 'light',
    frontendVersion: null,
    backendVersion: null,
    backupVersion: null,
    onReportIssue: vi.fn(),
    children: <div data-testid="main-content">Page content</div>,
    ...overrides,
  }
}

describe('AppShell', () => {
  describe('rendering', () => {
    it('renders toolbar with HRIV title', () => {
      render(<AppShell {...makeProps()} />)
      expect(screen.getByRole('heading', { name: 'HRIV' })).toBeInTheDocument()
    })

    it('renders children', () => {
      render(<AppShell {...makeProps()} />)
      expect(screen.getByTestId('main-content')).toBeInTheDocument()
    })

    it('renders the notification slot when provided', () => {
      render(
        <AppShell
          {...makeProps({
            notificationSlot: <button type="button">Notifications</button>,
          })}
        />,
      )
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    })

    it('renders announcement banner when announcement is set', () => {
      render(<AppShell {...makeProps({ announcement: 'Maintenance tonight' })} />)
      expect(screen.getByText('Maintenance tonight')).toBeInTheDocument()
    })

    it('keeps the full announcement row on the people/admin surface background', () => {
      render(
        <AppShell
          {...makeProps({
            page: 'people',
            announcement: 'Maintenance tonight',
          })}
        />,
      )

      expect(
        screen.getByText('Maintenance tonight').closest('.MuiContainer-root')?.parentElement,
      ).toHaveStyle({
        backgroundColor: '#DAC7B5',
      })
    })

    it('renders dismiss link on announcement banner when callback provided', async () => {
      const onDismiss = vi.fn()
      render(
        <AppShell
          {...makeProps({
            announcement: 'Maintenance tonight',
            onDismissAnnouncement: onDismiss,
          })}
        />,
      )
      const link = screen.getByRole('button', { name: 'Dismiss' })
      fireEvent.click(link)
      await waitFor(() => {
        expect(onDismiss).toHaveBeenCalledTimes(1)
      })
    })

    it('does not render announcement banner when empty', () => {
      render(<AppShell {...makeProps({ announcement: '' })} />)
      expect(screen.queryByText('Maintenance tonight')).not.toBeInTheDocument()
    })

    it('renders footer with report issue link', () => {
      render(<AppShell {...makeProps()} />)
      expect(screen.getByText('Report issue')).toBeInTheDocument()
    })

    it('renders version info in footer for admin users', () => {
      render(
        <AppShell
          {...makeProps({
            canManageUsers: true,
            frontendVersion: '1.2.3',
            backendVersion: '4.5.6',
            backupVersion: '7.8.9',
          })}
        />,
      )
      expect(screen.getByText('1.2.3')).toBeInTheDocument()
      expect(screen.getByText('4.5.6')).toBeInTheDocument()
      expect(screen.getByText('7.8.9')).toBeInTheDocument()
    })

    it('does not render version info for non-admin users', () => {
      render(
        <AppShell
          {...makeProps({
            canManageUsers: false,
            frontendVersion: '1.2.3',
          })}
        />,
      )
      expect(screen.queryByText('1.2.3')).not.toBeInTheDocument()
    })
  })

  describe('tabs', () => {
    it('renders Home tab always', () => {
      render(
        <AppShell
          {...makeProps({
            canEditContent: false,
            canManageUsers: false,
          })}
        />,
      )
      expect(screen.getByRole('tab', { name: 'Home' })).toBeInTheDocument()
    })

    it('renders Images and Manage tabs when canEditContent', () => {
      render(<AppShell {...makeProps({ canEditContent: true })} />)
      expect(screen.getByRole('tab', { name: 'Images' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Manage' })).toBeInTheDocument()
    })

    it('hides Images and Manage tabs when not canEditContent', () => {
      render(<AppShell {...makeProps({ canEditContent: false })} />)
      expect(screen.queryByRole('tab', { name: 'Images' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Manage' })).not.toBeInTheDocument()
    })

    it('renders People and Admin tabs when canManageUsers', () => {
      render(<AppShell {...makeProps({ canManageUsers: true })} />)
      expect(screen.getByRole('tab', { name: 'People' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Admin' })).toBeInTheDocument()
    })

    it('hides People and Admin tabs when not canManageUsers', () => {
      render(<AppShell {...makeProps({ canManageUsers: false })} />)
      expect(screen.queryByRole('tab', { name: 'People' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Admin' })).not.toBeInTheDocument()
    })

    it('calls onHomeClick when Home tab is clicked while already on browse', () => {
      const props = makeProps({ page: 'browse' })
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Home' }))
      expect(props.onHomeClick).toHaveBeenCalled()
    })

    it('does not call onHomeClick when Home tab is clicked from another page', () => {
      const props = makeProps({ page: 'manage' })
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Home' }))
      expect(props.onHomeClick).not.toHaveBeenCalled()
    })

    it("calls onTabChange with 'manage' when Images tab is clicked", () => {
      const props = makeProps({ page: 'browse' })
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Images' }))
      expect(props.onTabChange).toHaveBeenCalledWith('manage')
    })

    it("calls onTabChange with 'people' when People tab is clicked", () => {
      const props = makeProps({ page: 'browse' })
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'People' }))
      expect(props.onTabChange).toHaveBeenCalledWith('people')
    })

    it("calls onTabChange with 'admin' when Admin tab is clicked", () => {
      const props = makeProps({ page: 'browse' })
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
      expect(props.onTabChange).toHaveBeenCalledWith('admin')
    })
  })

  describe('manage menu', () => {
    it('opens manage menu when Manage tab is clicked', () => {
      render(<AppShell {...makeProps()} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
      expect(screen.getByRole('menuitem', { name: 'Categories' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Programs' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Announcement' })).toBeInTheDocument()
    })

    it('hides Programs menu item for non-admin editors', () => {
      render(
        <AppShell
          {...makeProps({
            canEditContent: true,
            canManageUsers: false,
          })}
        />,
      )
      fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
      expect(screen.getByRole('menuitem', { name: 'Categories' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Announcement' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Programs' })).not.toBeInTheDocument()
    })

    it('calls onOpenCategories when Categories menu item is clicked', () => {
      const props = makeProps()
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Categories' }))
      expect(props.onOpenCategories).toHaveBeenCalled()
    })

    it('calls onOpenPrograms when Programs menu item is clicked', () => {
      const props = makeProps()
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Programs' }))
      expect(props.onOpenPrograms).toHaveBeenCalled()
    })

    it('shows Groups menu item for non-admin editors (instructors)', () => {
      render(
        <AppShell
          {...makeProps({
            canEditContent: true,
            canManageUsers: false,
          })}
        />,
      )
      fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
      expect(screen.getByRole('menuitem', { name: 'Groups' })).toBeInTheDocument()
    })

    it('calls onOpenGroups when Groups menu item is clicked', () => {
      const props = makeProps()
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Groups' }))
      expect(props.onOpenGroups).toHaveBeenCalled()
    })

    it('calls onOpenAnnouncement when Announcement menu item is clicked', () => {
      const props = makeProps()
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Announcement' }))
      expect(props.onOpenAnnouncement).toHaveBeenCalled()
    })
  })

  describe('toolbar actions', () => {
    it('calls onSearchOpen when search button is clicked', () => {
      const props = makeProps()
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByLabelText('Search'))
      expect(props.onSearchOpen).toHaveBeenCalled()
    })

    it('renders user avatar with initials', () => {
      render(
        <AppShell
          {...makeProps({
            currentUser: {
              name: 'Jane Doe',
              email: 'j@t.com',
              role: 'admin',
              program_names: [],
              group_names: [],
            },
          })}
        />,
      )
      expect(screen.getByText('JD')).toBeInTheDocument()
    })

    it('calls onReportIssue when Report issue link is clicked', () => {
      const props = makeProps()
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByText('Report issue'))
      expect(props.onReportIssue).toHaveBeenCalled()
    })
  })

  describe('profile popover', () => {
    it('keeps the theme toggle in the bar on desktop', () => {
      render(<AppShell {...makeProps({ profileOpen: false })} />)
      expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument()
    })

    it('does not add a theme row to the profile menu on desktop', () => {
      render(<AppShell {...makeProps({ profileOpen: true })} />)
      expect(screen.queryByRole('menuitem', { name: /Theme:/ })).not.toBeInTheDocument()
    })

    it('shows user info when profileOpen is true', () => {
      const ref = createRef<HTMLButtonElement>()
      render(
        <AppShell
          {...makeProps({
            profileOpen: true,
            avatarRef: ref,
            currentUser: {
              name: 'Test User',
              email: 'test@example.com',
              role: 'admin',
              program_names: ['CS', 'Math'],
              group_names: [],
            },
          })}
        />,
      )
      expect(screen.getByText('test@example.com')).toBeInTheDocument()
      expect(screen.getByText('CS')).toBeInTheDocument()
      expect(screen.getByText('Math')).toBeInTheDocument()
    })

    it("shows the caller's group chips in the profile popover", () => {
      render(
        <AppShell
          {...makeProps({
            profileOpen: true,
            currentUser: {
              name: 'Stu Dent',
              email: 'stu@example.com',
              role: 'student',
              program_names: [],
              group_names: ['Field Studies', 'Capstone'],
            },
          })}
        />,
      )
      expect(screen.getByText('Field Studies')).toBeInTheDocument()
      expect(screen.getByText('Capstone')).toBeInTheDocument()
    })

    it('caps the profile popover width so chips wrap vertically', () => {
      render(
        <AppShell
          {...makeProps({
            profileOpen: true,
            currentUser: {
              name: 'Stu Dent',
              email: 'stu@example.com',
              role: 'student',
              program_names: ['Program A', 'Program B', 'Program C'],
              group_names: ['Group A', 'Group B', 'Group C'],
            },
          })}
        />,
      )

      expect(screen.getByText('stu@example.com').closest('.MuiCard-root')).toHaveStyle({
        maxWidth: '280px',
      })
    })

    it('shows Update link when canManageUsers', () => {
      render(<AppShell {...makeProps({ profileOpen: true, canManageUsers: true })} />)
      expect(screen.getByText('Update')).toBeInTheDocument()
    })

    it('hides Update link when not canManageUsers', () => {
      render(<AppShell {...makeProps({ profileOpen: true, canManageUsers: false })} />)
      expect(screen.queryByText('Update')).not.toBeInTheDocument()
    })

    it('calls openEditProfile when Update is clicked', () => {
      const props = makeProps({ profileOpen: true })
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByText('Update'))
      expect(props.openEditProfile).toHaveBeenCalled()
    })

    it('calls logout and closes popover when Logout is clicked', () => {
      const props = makeProps({ profileOpen: true })
      render(<AppShell {...props} />)
      fireEvent.click(screen.getByText('Logout'))
      expect(props.setProfileOpen).toHaveBeenCalledWith(false)
      expect(props.logout).toHaveBeenCalled()
    })

    it('shows View Announcement link when announcement is enabled and dismissed', () => {
      render(
        <AppShell
          {...makeProps({
            profileOpen: true,
            annEnabled: true,
            annMessage: 'Scheduled maintenance',
            announcement: '',
          })}
        />,
      )
      expect(screen.getByText('View Announcement')).toBeInTheDocument()
    })

    it('hides View Announcement link when announcement banner is visible (not dismissed)', () => {
      render(
        <AppShell
          {...makeProps({
            profileOpen: true,
            annEnabled: true,
            annMessage: 'Scheduled maintenance',
            announcement: 'Scheduled maintenance',
          })}
        />,
      )
      expect(screen.queryByText('View Announcement')).not.toBeInTheDocument()
    })

    it('hides View Announcement link when no announcement is enabled', () => {
      render(
        <AppShell
          {...makeProps({
            profileOpen: true,
            annEnabled: false,
            annMessage: '',
            announcement: '',
          })}
        />,
      )
      expect(screen.queryByText('View Announcement')).not.toBeInTheDocument()
    })

    it('opens announcement dialog when View Announcement is clicked', () => {
      render(
        <AppShell
          {...makeProps({
            profileOpen: true,
            annEnabled: true,
            annMessage: 'Scheduled maintenance',
            announcement: '',
          })}
        />,
      )
      fireEvent.click(screen.getByText('View Announcement'))
      expect(screen.getByText('Announcement')).toBeInTheDocument()
      expect(screen.getByText('Scheduled maintenance')).toBeInTheDocument()
    })
  })

  describe('compact viewport navigation', () => {
    beforeEach(() => {
      mockUseMediaQuery.mockReturnValue(true)
    })
    afterEach(() => {
      // Clear call history as well as the implementation, then restore the
      // file-wide default so later suites start from a desktop viewport.
      mockUseMediaQuery.mockReset()
      mockUseMediaQuery.mockReturnValue(false)
    })

    it('collapses the nav tabs into a hamburger menu', () => {
      render(<AppShell {...makeProps()} />)
      expect(screen.getByRole('button', { name: 'Open navigation menu' })).toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Images' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Admin' })).not.toBeInTheDocument()
    })

    it('exposes every destination, with Manage flattened, in the menu', () => {
      render(<AppShell {...makeProps()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
      for (const name of [
        'Home',
        'Images',
        'Categories',
        'Programs',
        'Groups',
        'Announcement',
        'People',
        'Admin',
      ]) {
        expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
      }
    })

    it('renders the Manage section heading as a distinct uppercased label', () => {
      render(<AppShell {...makeProps()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
      const heading = screen.getByText('Manage')
      expect(heading).toBeInTheDocument()
      // Not a clickable menu item — it's a section label.
      expect(heading).not.toHaveAttribute('role', 'menuitem')
      expect(heading).toHaveStyle({ textTransform: 'uppercase' })
    })

    it('navigates and opens dialogs from the collapsed menu', () => {
      const onTabChange = vi.fn()
      const onOpenCategories = vi.fn()
      render(<AppShell {...makeProps({ onTabChange, onOpenCategories })} />)

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Admin' }))
      expect(onTabChange).toHaveBeenCalledWith('admin')

      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Categories' }))
      expect(onOpenCategories).toHaveBeenCalled()
    })

    it('removes the theme toggle from the bar when collapsed', () => {
      render(<AppShell {...makeProps({ profileOpen: false })} />)
      expect(screen.queryByRole('button', { name: 'Toggle theme' })).not.toBeInTheDocument()
    })

    it('shows a theme row in the profile menu on compact viewports', () => {
      render(<AppShell {...makeProps({ profileOpen: true })} />)
      expect(screen.getByRole('menuitem', { name: /Theme:/ })).toBeInTheDocument()
    })

    it('keeps the role and program/group pills in the profile menu', () => {
      render(
        <AppShell
          {...makeProps({
            profileOpen: true,
            currentUser: {
              name: 'Haruki Tanaka',
              email: 'admin@example.ca',
              role: 'admin',
              program_names: ['Administration'],
              group_names: [],
            },
          })}
        />,
      )
      expect(screen.getByText('admin@example.ca')).toBeInTheDocument()
      expect(screen.getByText('admin')).toBeInTheDocument()
      expect(screen.getByText('Administration')).toBeInTheDocument()
    })

    it('keeps a single Home tab inline for students instead of collapsing', () => {
      render(<AppShell {...makeProps({ canEditContent: false, canManageUsers: false })} />)
      expect(screen.queryByRole('button', { name: 'Open navigation menu' })).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Home' })).toBeInTheDocument()
    })

    it('closes the drawer when the close button is clicked', () => {
      render(<AppShell {...makeProps()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
      expect(screen.getByRole('menuitem', { name: 'Home' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }))

      expect(screen.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      expect(screen.queryByRole('menuitem', { name: 'Home' })).not.toBeInTheDocument()
    })

    it('does not reopen the drawer after a compact → desktop → compact resize', () => {
      const { rerender } = render(<AppShell {...makeProps()} />)
      // Open the drawer on the compact viewport.
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
      expect(screen.getByRole('menuitem', { name: 'Home' })).toBeInTheDocument()

      // Resize up to desktop (drawer unmounts) and back down to compact.
      mockUseMediaQuery.mockReturnValue(false)
      rerender(<AppShell {...makeProps()} />)
      mockUseMediaQuery.mockReturnValue(true)
      rerender(<AppShell {...makeProps()} />)

      // The drawer must stay closed — no auto-reopen.
      expect(screen.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      expect(screen.queryByRole('menuitem', { name: 'Home' })).not.toBeInTheDocument()
    })
  })

  describe('viewport transitions', () => {
    afterEach(() => {
      mockUseMediaQuery.mockReset()
      mockUseMediaQuery.mockReturnValue(false)
    })

    it('closes the Manage dropdown after a desktop → compact → desktop resize', () => {
      mockUseMediaQuery.mockReturnValue(false) // desktop: inline tabs
      const { rerender } = render(<AppShell {...makeProps()} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Manage' }))
      expect(screen.getByRole('menuitem', { name: 'Categories' })).toBeInTheDocument()

      // Resize into compact (tab + dropdown unmount) and back to desktop.
      mockUseMediaQuery.mockReturnValue(true)
      rerender(<AppShell {...makeProps()} />)
      mockUseMediaQuery.mockReturnValue(false)
      rerender(<AppShell {...makeProps()} />)

      // The dropdown must not reopen against the unmounted tab.
      expect(screen.queryByRole('menuitem', { name: 'Categories' })).not.toBeInTheDocument()
    })
  })
})
