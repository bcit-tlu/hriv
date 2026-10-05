import { describe, it, expect } from 'vitest'
import { getNavigationItems } from '../src/navigation'
import type { NavigationItem } from '../src/navigation'

const ALL_IDS = [
  'home',
  'collections-sequence',
  'collections-synchronized',
  'images',
  'categories',
  'manage-collections',
  'programs',
  'groups',
  'announcement',
  'people',
  'admin',
]

describe('getNavigationItems', () => {
  it('returns all items for admin (canEditContent + canManageUsers + canViewPeople)', () => {
    const items = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: true,
      canManageUsers: true,
      canViewPeople: true,
    })
    expect(items.map((i) => i.id)).toEqual(ALL_IDS)
  })

  it('returns all items for instructor (canEditContent, no canManageUsers/canViewPeople)', () => {
    const items = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: true,
      canManageUsers: false,
      canViewPeople: false,
    })
    const ids = items.map((i) => i.id)
    expect(ids).toContain('home')
    expect(ids).toContain('images')
    expect(ids).toContain('categories')
    expect(ids).toContain('groups')
    expect(ids).toContain('announcement')
    expect(ids).not.toContain('programs')
    expect(ids).not.toContain('people')
    expect(ids).not.toContain('admin')
  })

  it('returns only unrestricted items for student (no edit, no manage users, no people)', () => {
    const items = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: false,
    })
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(['home', 'collections-sequence', 'collections-synchronized'])
  })

  it('returns type pages + people for staff — plus the manage collections table (#1554)', () => {
    const items = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: true,
    })
    const ids = items.map((i) => i.id)
    expect(ids).toEqual([
      'home',
      'collections-sequence',
      'collections-synchronized',
      'manage-collections',
      'people',
    ])
  })

  it('collections type pages are primary items for every role (#1554)', () => {
    for (const canEditContent of [true, false]) {
      for (const canManageUsers of [true, false]) {
        for (const canViewPeople of [true, false]) {
          const items = getNavigationItems({
            collectionsEnabled: true,
            canEditContent,
            canManageUsers,
            canViewPeople,
          })
          for (const type of ['sequence', 'synchronized'] as const) {
            const item = items.find((i) => i.id === `collections-${type}`)
            expect(item).toBeDefined()
            expect(item?.section).toBe('primary')
            expect(item?.page).toBe('collections')
            expect(item?.collectionType).toBe(type)
          }
        }
      }
    }
  })

  it('staff sees only the collections table among manage items (#1554)', () => {
    const items = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: true,
    })
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain('admin')
    expect(items.filter((i) => i.section === 'manage').map((i) => i.id)).toEqual([
      'manage-collections',
    ])
  })

  it('includes manage-section items for instructor with correct sections', () => {
    const items = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: true,
      canManageUsers: false,
      canViewPeople: false,
    })
    const manageItems = items.filter((i) => i.section === 'manage')
    expect(manageItems.map((i) => i.id).sort()).toEqual([
      'announcement',
      'categories',
      'groups',
      'manage-collections',
    ])
  })

  it('includes account-section items only for admin or staff', () => {
    const withoutManage = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: true,
      canManageUsers: false,
      canViewPeople: false,
    })
    expect(withoutManage.filter((i) => i.section === 'account')).toEqual([])

    const withManage = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: true,
      canManageUsers: true,
      canViewPeople: true,
    })
    const accountItems = withManage.filter((i) => i.section === 'account')
    expect(accountItems.map((i) => i.id)).toEqual(['people', 'admin'])

    const staff = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: true,
    })
    const staffAccount = staff.filter((i) => i.section === 'account')
    expect(staffAccount.map((i) => i.id)).toEqual(['people'])
  })

  it('preserves item ordering regardless of permissions', () => {
    const adminItems = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: true,
      canManageUsers: true,
      canViewPeople: true,
    })
    const studentItems = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: false,
    })
    // Student items should be a prefix of admin items (all unrestricted items come first)
    expect(adminItems.slice(0, studentItems.length)).toEqual(studentItems)
  })

  it('each returned item satisfies the required permission gates', () => {
    const items: NavigationItem[] = getNavigationItems({
      collectionsEnabled: true,
      canEditContent: true,
      canManageUsers: false,
      canViewPeople: false,
    })
    for (const item of items) {
      if (item.requiresEditContent) {
        // canEditContent is true, so these are allowed
      }
      if (item.requiresManageUsers) {
        // canManageUsers is false, so these should not appear
        throw new Error(`Item ${item.id} should not be included without canManageUsers`)
      }
      if (item.requiresViewPeople) {
        // canViewPeople is false, so these should not appear
        throw new Error(`Item ${item.id} should not be included without canViewPeople`)
      }
    }
  })

  it('omits Collections for every role when the deployment flag is off', () => {
    const roles = [
      { canEditContent: true, canManageUsers: true, canViewPeople: true },
      { canEditContent: true, canManageUsers: false, canViewPeople: false },
      { canEditContent: false, canManageUsers: false, canViewPeople: true },
      { canEditContent: false, canManageUsers: false, canViewPeople: false },
    ]
    for (const caps of roles) {
      const ids = getNavigationItems({ ...caps, collectionsEnabled: false }).map((i) => i.id)
      expect(ids).not.toContain('collections-sequence')
      expect(ids).not.toContain('collections-synchronized')
      expect(ids).not.toContain('manage-collections')
      expect(ids[0]).toBe('home')
    }
    expect(
      getNavigationItems({
        canEditContent: false,
        canManageUsers: false,
        canViewPeople: false,
        collectionsEnabled: false,
      }).map((i) => i.id),
    ).toEqual(['home'])
  })
})
