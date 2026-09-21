import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import AppShell, { type Page } from './AppShell'
import type { Role } from '../types'

interface ShellArgs {
  page: Page
  role: Role
  canEditContent: boolean
  canManageUsers: boolean
  announcementEnabled: boolean
}

// AppShell needs a ref + controlled profile-popover state; a wrapper supplies
// them so the story stays declarative. This is the app chrome: at desktop width
// it shows the tab bar, at mobile width a hamburger + drawer — the inherited
// responsive modes capture both from a single story.
function AppShellExample({
  page,
  role,
  canEditContent,
  canManageUsers,
  announcementEnabled,
}: ShellArgs) {
  const avatarRef = useRef<HTMLButtonElement | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  return (
    <AppShell
      page={page}
      onTabChange={fn()}
      onHomeClick={fn()}
      canEditContent={canEditContent}
      canManageUsers={canManageUsers}
      currentUser={{
        name: 'Dana Lee',
        email: 'dana.lee@bcit.ca',
        role,
        program_names: ['Architecture'],
        group_names: ['Faculty'],
      }}
      announcement=""
      annMessage="Scheduled maintenance Sunday 02:00–03:00 PT."
      annEnabled={announcementEnabled}
      onDismissAnnouncement={fn()}
      profileOpen={profileOpen}
      setProfileOpen={setProfileOpen}
      avatarRef={avatarRef}
      openEditProfile={fn()}
      logout={fn()}
      onOpenCategories={fn()}
      onOpenPrograms={fn()}
      onOpenGroups={fn()}
      onOpenAnnouncement={fn()}
      onSearchOpen={fn()}
      mode="light"
      frontendVersion="0.51.0"
      backendVersion="0.49.0"
      backupVersion="0.12.0"
      onReportIssue={fn()}
    >
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          {page[0].toUpperCase() + page.slice(1)} page
        </Typography>
        <Typography color="text.secondary">Main content renders here.</Typography>
      </Box>
    </AppShell>
  )
}

const meta = {
  title: 'Components/AppShell',
  component: AppShellExample,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Top-level app chrome: app bar, role-gated navigation (tabs on desktop, hamburger ' +
          'drawer on mobile), search, notifications, profile menu, and footer. All identity and ' +
          'data arrive via props.',
      },
    },
  },
  args: {
    page: 'browse',
    role: 'admin',
    canEditContent: true,
    canManageUsers: true,
    announcementEnabled: false,
  },
  argTypes: {
    page: { control: 'select', options: ['browse', 'manage', 'people', 'admin', 'guide'] },
    role: { control: 'select', options: ['admin', 'instructor', 'student'] },
  },
} satisfies Meta<typeof AppShellExample>

export default meta

type Story = StoryObj<typeof meta>

export const AdminBrowse: Story = {
  name: 'Admin — Browse',
}

export const StudentBrowse: Story = {
  name: 'Student — Browse (limited nav)',
  args: { role: 'student', canEditContent: false, canManageUsers: false },
}

export const WithAnnouncement: Story = {
  name: 'With Announcement Banner',
  args: { announcementEnabled: true },
}
