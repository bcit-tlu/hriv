/**
 * Unit tests for the DrawerContentExample component from drawer.stories.tsx.
 *
 * Covers:
 * 1. Navigation content — renders correct items per role
 * 2. Manage section subheader — appears only when manage items are present
 * 3. Settings content — renders Settings heading
 * 4. Long content — renders generic menu items
 * 5. Close button — renders and calls onClose when showCloseButton is true
 * 6. No close button — hidden when showCloseButton is false
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DrawerContentExample } from '../../src/drawer.stories'

describe('DrawerContentExample', () => {
  // ─── Navigation content per role ───────────────────────────────

  describe('navigation content', () => {
    it('renders all navigation items for admin role', () => {
      render(
        <DrawerContentExample
          content="navigation"
          onClose={vi.fn()}
          role="admin"
          showCloseButton={false}
        />,
      )
      expect(screen.getByText('Home')).toBeInTheDocument()
      expect(screen.getByText('Images')).toBeInTheDocument()
      expect(screen.getByText('Categories')).toBeInTheDocument()
      expect(screen.getByText('Programs')).toBeInTheDocument()
      expect(screen.getByText('Groups')).toBeInTheDocument()
      expect(screen.getByText('Announcements')).toBeInTheDocument()
      expect(screen.getByText('People')).toBeInTheDocument()
      expect(screen.getByText('Admin')).toBeInTheDocument()
    })

    it('renders edit-content items but not manage-users items for instructor role', () => {
      render(
        <DrawerContentExample
          content="navigation"
          onClose={vi.fn()}
          role="instructor"
          showCloseButton={false}
        />,
      )
      expect(screen.getByText('Home')).toBeInTheDocument()
      expect(screen.getByText('Images')).toBeInTheDocument()
      expect(screen.getByText('Categories')).toBeInTheDocument()
      expect(screen.getByText('Groups')).toBeInTheDocument()
      expect(screen.getByText('Announcements')).toBeInTheDocument()
      expect(screen.queryByText('Programs')).not.toBeInTheDocument()
      expect(screen.queryByText('People')).not.toBeInTheDocument()
      expect(screen.queryByText('Admin')).not.toBeInTheDocument()
    })

    it('renders only Home for student role', () => {
      render(
        <DrawerContentExample
          content="navigation"
          onClose={vi.fn()}
          role="student"
          showCloseButton={false}
        />,
      )
      expect(screen.getByText('Home')).toBeInTheDocument()
      expect(screen.queryByText('Images')).not.toBeInTheDocument()
      expect(screen.queryByText('Categories')).not.toBeInTheDocument()
    })
  })

  // ─── Manage section subheader ──────────────────────────────────

  describe('manage section subheader', () => {
    it('renders the Manage subheader when manage items are present', () => {
      render(
        <DrawerContentExample
          content="navigation"
          onClose={vi.fn()}
          role="admin"
          showCloseButton={false}
        />,
      )
      expect(screen.getByText('Manage')).toBeInTheDocument()
    })

    it('does not render the Manage subheader when no manage items are present', () => {
      render(
        <DrawerContentExample
          content="navigation"
          onClose={vi.fn()}
          role="student"
          showCloseButton={false}
        />,
      )
      expect(screen.queryByText('Manage')).not.toBeInTheDocument()
    })
  })

  // ─── Settings content ──────────────────────────────────────────

  describe('settings content', () => {
    it('renders the Settings heading', () => {
      render(
        <DrawerContentExample
          content="settings"
          onClose={vi.fn()}
          role="admin"
          showCloseButton={false}
        />,
      )
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    })
  })

  // ─── Long content ──────────────────────────────────────────────

  describe('long content', () => {
    it('renders generic menu items', () => {
      render(
        <DrawerContentExample
          content="long content"
          onClose={vi.fn()}
          role="admin"
          showCloseButton={false}
        />,
      )
      expect(screen.getByText('Menu item 1')).toBeInTheDocument()
      expect(screen.getByText('Menu item 8')).toBeInTheDocument()
    })
  })

  // ─── Close button ──────────────────────────────────────────────

  describe('close button', () => {
    it('renders the close button when showCloseButton is true', () => {
      render(
        <DrawerContentExample
          content="navigation"
          onClose={vi.fn()}
          role="admin"
          showCloseButton={true}
        />,
      )
      expect(screen.getByLabelText('Close drawer')).toBeInTheDocument()
    })

    it('does not render the close button when showCloseButton is false', () => {
      render(
        <DrawerContentExample
          content="navigation"
          onClose={vi.fn()}
          role="admin"
          showCloseButton={false}
        />,
      )
      expect(screen.queryByLabelText('Close drawer')).not.toBeInTheDocument()
    })

    it('calls onClose when the close button is clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <DrawerContentExample
          content="navigation"
          onClose={onClose}
          role="admin"
          showCloseButton={true}
        />,
      )
      await user.click(screen.getByLabelText('Close drawer'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
