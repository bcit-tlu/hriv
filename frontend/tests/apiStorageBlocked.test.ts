/**
 * Targeted coverage for api.ts behavior when localStorage is blocked or
 * throwing (private browsing, disabled storage, security policies).
 *
 * jsdom's default Storage stays installed for every other test file; these
 * tests temporarily replace the `localStorage` global (restored after each
 * test) and re-import api.ts so its module-level token read runs against the
 * blocked storage.
 *
 * Covers (see issue #717):
 * 1. Importing api.ts does not crash when storage access throws
 * 2. setToken(token) / setToken(null) fail gracefully without storage
 * 3. clearUserStorage() still clears in-memory auth state when storage throws
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function blockedError(): DOMException {
  return new DOMException('Storage is blocked', 'SecurityError')
}

/** Simulates storage blocked at the property level: any access throws. */
function installThrowingAccessor() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw blockedError()
    },
  })
}

/** Simulates a Storage object whose every operation throws. */
function installThrowingStorage() {
  const throwing = {
    get length(): number {
      throw blockedError()
    },
    clear() {
      throw blockedError()
    },
    getItem(): string | null {
      throw blockedError()
    },
    key(): string | null {
      throw blockedError()
    },
    removeItem() {
      throw blockedError()
    },
    setItem() {
      throw blockedError()
    },
  } as Storage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: throwing,
  })
}

function restoreStorage() {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
  } else {
    delete (globalThis as Record<string, unknown>).localStorage
  }
}

/** Re-imports api.ts so its module-level stored-token read re-runs. */
async function importApi() {
  vi.resetModules()
  return import('../src/api')
}

afterEach(() => {
  restoreStorage()
  vi.resetModules()
})

describe('api.ts with blocked localStorage', () => {
  it('imports without crashing when the localStorage accessor throws', async () => {
    // Seed a real stored token first so the null assertion below proves the
    // blocked path was taken (a working storage would surface this token).
    globalThis.localStorage.setItem('hriv_token', 'seeded-token')
    try {
      installThrowingAccessor()
      const api = await importApi()
      expect(api.getToken()).toBeNull()
    } finally {
      restoreStorage()
      globalThis.localStorage.removeItem('hriv_token')
    }
  })

  it('imports without crashing when every storage operation throws', async () => {
    installThrowingStorage()
    const api = await importApi()
    expect(api.getToken()).toBeNull()
  })

  it('setToken stores the token in memory when storage operations throw', async () => {
    installThrowingStorage()
    const api = await importApi()

    api.setToken('in-memory-token')
    expect(api.getToken()).toBe('in-memory-token')

    api.setToken(null)
    expect(api.getToken()).toBeNull()
  })

  it('setToken works in memory when the localStorage accessor throws', async () => {
    installThrowingAccessor()
    const api = await importApi()

    api.setToken('in-memory-token')
    expect(api.getToken()).toBe('in-memory-token')

    api.setToken(null)
    expect(api.getToken()).toBeNull()
  })

  it('clearUserStorage clears the in-memory token when storage operations throw', async () => {
    installThrowingStorage()
    const api = await importApi()

    api.setToken('in-memory-token')
    api.clearUserStorage()
    expect(api.getToken()).toBeNull()
  })

  it('clearUserStorage clears the in-memory token when the localStorage accessor throws', async () => {
    installThrowingAccessor()
    const api = await importApi()

    api.setToken('in-memory-token')
    api.clearUserStorage()
    expect(api.getToken()).toBeNull()
  })

  it('does not disturb tokens persisted by working storage in other tests', async () => {
    restoreStorage()
    const api = await importApi()
    api.setToken('persisted-token')
    expect(globalThis.localStorage.getItem('hriv_token')).toBe('persisted-token')
    api.setToken(null)
    expect(globalThis.localStorage.getItem('hriv_token')).toBeNull()
  })
})
