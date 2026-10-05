export type NavigationPage =
  'browse' | 'collections' | 'manage' | 'manage-collections' | 'people' | 'admin'
export type NavigationSection = 'primary' | 'manage' | 'account'
export type NavigationIcon =
  | 'home'
  | 'collections'
  | 'images'
  | 'categories'
  | 'programs'
  | 'groups'
  | 'announcement'
  | 'people'
  | 'admin'

export interface NavigationItem {
  id: string
  label: string
  section: NavigationSection
  icon: NavigationIcon
  page?: NavigationPage
  /** For `page: 'collections'` items — which type sub-page the item opens. */
  collectionType?: 'sequence' | 'synchronized'
  requiresEditContent?: boolean
  requiresManageUsers?: boolean
  requiresViewPeople?: boolean
  /** Hidden unless the deployment's `collections` feature flag is on. */
  requiresCollections?: boolean
  /** Hidden from students: visible to admins, instructors, and staff. */
  requiresNonStudent?: boolean
}

const navigationItems: readonly NavigationItem[] = [
  { id: 'home', label: 'Home', section: 'primary', icon: 'home', page: 'browse' },
  // Visible to every role (students included) — collections are a browsing
  // feature, not a management one; the API scopes what each caller can see.
  // Dark-launched: only rendered when the deployment enables collections.
  {
    id: 'collections-sequence',
    label: 'Sequence collections',
    section: 'primary',
    icon: 'collections',
    page: 'collections',
    collectionType: 'sequence',
    requiresCollections: true,
  },
  {
    id: 'collections-synchronized',
    label: 'Synchronized collections',
    section: 'primary',
    icon: 'collections',
    page: 'collections',
    collectionType: 'synchronized',
    requiresCollections: true,
  },
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
  // All-collections manage table (#1554). Staff reach it too — mirroring
  // their read-level access to the image manage surface — so this gates on
  // "not a student" rather than `requiresEditContent`.
  {
    id: 'manage-collections',
    label: 'Collections',
    section: 'manage',
    icon: 'collections',
    page: 'manage-collections',
    requiresCollections: true,
    requiresNonStudent: true,
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
  collectionsEnabled,
}: {
  canEditContent: boolean
  canManageUsers: boolean
  canViewPeople: boolean
  collectionsEnabled: boolean
}): NavigationItem[] {
  return navigationItems.filter(
    (item) =>
      (!item.requiresEditContent || canEditContent) &&
      (!item.requiresManageUsers || canManageUsers) &&
      (!item.requiresViewPeople || canViewPeople) &&
      (!item.requiresCollections || collectionsEnabled) &&
      (!item.requiresNonStudent || canEditContent || canViewPeople),
  )
}
