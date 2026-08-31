export type NavigationPage = 'browse' | 'manage' | 'people' | 'admin'
export type NavigationSection = 'primary' | 'manage' | 'account'
export type NavigationIcon =
  'home' | 'images' | 'categories' | 'programs' | 'groups' | 'announcement' | 'people' | 'admin'

export interface NavigationItem {
  id: string
  label: string
  section: NavigationSection
  icon: NavigationIcon
  page?: NavigationPage
  requiresEditContent?: boolean
  requiresManageUsers?: boolean
}

const navigationItems: readonly NavigationItem[] = [
  { id: 'home', label: 'Home', section: 'primary', icon: 'home', page: 'browse' },
  {
    id: 'images',
    label: 'Images',
    section: 'primary',
    icon: 'images',
    page: 'manage',
    requiresEditContent: true,
  },
  {
    id: 'categories',
    label: 'Categories',
    section: 'manage',
    icon: 'categories',
    requiresEditContent: true,
  },
  {
    id: 'programs',
    label: 'Programs',
    section: 'manage',
    icon: 'programs',
    requiresEditContent: true,
    requiresManageUsers: true,
  },
  {
    id: 'groups',
    label: 'Groups',
    section: 'manage',
    icon: 'groups',
    requiresEditContent: true,
  },
  {
    id: 'announcement',
    label: 'Announcements',
    section: 'manage',
    icon: 'announcement',
    requiresEditContent: true,
  },
  {
    id: 'people',
    label: 'People',
    section: 'account',
    icon: 'people',
    page: 'people',
    requiresManageUsers: true,
  },
  {
    id: 'admin',
    label: 'Admin',
    section: 'account',
    icon: 'admin',
    page: 'admin',
    requiresManageUsers: true,
  },
]

export function getNavigationItems({
  canEditContent,
  canManageUsers,
}: {
  canEditContent: boolean
  canManageUsers: boolean
}): NavigationItem[] {
  return navigationItems.filter(
    (item) =>
      (!item.requiresEditContent || canEditContent) &&
      (!item.requiresManageUsers || canManageUsers),
  )
}
