import { describe, it, expect } from 'vitest'
import { getNavigationItems } from '../src/navigation'
import type { NavigationItem } from '../src/navigation'

const ALL_IDS = [
  'home',
  'images',
  'categories',
  'programs',
  'groups',
  'announcement',
  'people',
  'admin',
]

describe('getNavigationItems', () => {
  it('returns all items for admin (canEditContent + canManageUsers + canViewPeople)', () => {
    const items = getNavigationItems({
      canEditContent: true,
      canManageUsers: true,
      canViewPeople: true,
    })
    expect(items.map((i) => i.id)).toEqual(ALL_IDS)
  })

  it('returns all items for instructor (canEditContent, no canManageUsers/canViewPeople)', () => {
    const items = getNavigationItems({
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
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: false,
    })
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(['home'])
  })

  it('returns home + people for staff (view-only with people access)', () => {
    const items = getNavigationItems({
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: true,
    })
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(['home', 'people'])
  })

  it('staff never sees admin or manage items', () => {
    const items = getNavigationItems({
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: true,
    })
    const ids = items.map((i) => i.id)
    expect(ids).not.toContain('admin')
    expect(items.filter((i) => i.section === 'manage')).toEqual([])
  })

  it('includes manage-section items for instructor with correct sections', () => {
    const items = getNavigationItems({
      canEditContent: true,
      canManageUsers: false,
      canViewPeople: false,
    })
    const manageItems = items.filter((i) => i.section === 'manage')
    expect(manageItems.map((i) => i.id).sort()).toEqual(['announcement', 'categories', 'groups'])
  })

  it('includes account-section items only for admin or staff', () => {
    const withoutManage = getNavigationItems({
      canEditContent: true,
      canManageUsers: false,
      canViewPeople: false,
    })
    expect(withoutManage.filter((i) => i.section === 'account')).toEqual([])

    const withManage = getNavigationItems({
      canEditContent: true,
      canManageUsers: true,
      canViewPeople: true,
    })
    const accountItems = withManage.filter((i) => i.section === 'account')
    expect(accountItems.map((i) => i.id)).toEqual(['people', 'admin'])

    const staff = getNavigationItems({
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: true,
    })
    const staffAccount = staff.filter((i) => i.section === 'account')
    expect(staffAccount.map((i) => i.id)).toEqual(['people'])
  })

  it('preserves item ordering regardless of permissions', () => {
    const adminItems = getNavigationItems({
      canEditContent: true,
      canManageUsers: true,
      canViewPeople: true,
    })
    const studentItems = getNavigationItems({
      canEditContent: false,
      canManageUsers: false,
      canViewPeople: false,
    })
    // Student items should be a prefix of admin items (all unrestricted items come first)
    expect(adminItems.slice(0, studentItems.length)).toEqual(studentItems)
  })

  it('each returned item satisfies the required permission gates', () => {
    const items: NavigationItem[] = getNavigationItems({
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
})
