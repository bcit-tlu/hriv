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
  it('returns all items for admin (canEditContent + canManageUsers)', () => {
    const items = getNavigationItems({ canEditContent: true, canManageUsers: true })
    expect(items.map((i) => i.id)).toEqual(ALL_IDS)
  })

  it('returns all items for instructor (canEditContent, no canManageUsers)', () => {
    const items = getNavigationItems({ canEditContent: true, canManageUsers: false })
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

  it('returns only unrestricted items for student (no edit, no manage users)', () => {
    const items = getNavigationItems({ canEditContent: false, canManageUsers: false })
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(['home'])
  })

  it('includes manage-section items for instructor with correct sections', () => {
    const items = getNavigationItems({ canEditContent: true, canManageUsers: false })
    const manageItems = items.filter((i) => i.section === 'manage')
    expect(manageItems.map((i) => i.id).sort()).toEqual(['announcement', 'categories', 'groups'])
  })

  it('includes account-section items only when canManageUsers is true', () => {
    const withoutManage = getNavigationItems({ canEditContent: true, canManageUsers: false })
    expect(withoutManage.filter((i) => i.section === 'account')).toEqual([])

    const withManage = getNavigationItems({ canEditContent: true, canManageUsers: true })
    const accountItems = withManage.filter((i) => i.section === 'account')
    expect(accountItems.map((i) => i.id)).toEqual(['people', 'admin'])
  })

  it('preserves item ordering regardless of permissions', () => {
    const adminItems = getNavigationItems({ canEditContent: true, canManageUsers: true })
    const studentItems = getNavigationItems({ canEditContent: false, canManageUsers: false })
    // Student items should be a prefix of admin items (all unrestricted items come first)
    expect(adminItems.slice(0, studentItems.length)).toEqual(studentItems)
  })

  it('each returned item satisfies the required permission gates', () => {
    const items: NavigationItem[] = getNavigationItems({
      canEditContent: true,
      canManageUsers: false,
    })
    for (const item of items) {
      if (item.requiresEditContent) {
        // canEditContent is true, so these are allowed
      }
      if (item.requiresManageUsers) {
        // canManageUsers is false, so these should not appear
        throw new Error(`Item ${item.id} should not be included without canManageUsers`)
      }
    }
  })
})
