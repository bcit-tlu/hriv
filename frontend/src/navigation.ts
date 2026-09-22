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
  requiresViewPeople?: boolean
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
    label: 'Announcement',
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
    requiresViewPeople: true,
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
  canViewPeople,
}: {
  canEditContent: boolean
  canManageUsers: boolean
  canViewPeople: boolean
}): NavigationItem[] {
  return navigationItems.filter(
    (item) =>
      (!item.requiresEditContent || canEditContent) &&
      (!item.requiresManageUsers || canManageUsers) &&
      (!item.requiresViewPeople || canViewPeople),
  )
}
