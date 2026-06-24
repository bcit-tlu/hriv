import '@testing-library/jest-dom/vitest'
import { beforeAll } from 'vitest'

// @dnd-kit/dom requires ResizeObserver which jsdom does not provide.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}

// jsdom normally provides Web Storage, but Node >= 26 ships a native global
// `localStorage`/`sessionStorage` gated behind `--localstorage-file`. When the
// flag is absent the native global is unavailable yet still shadows jsdom's,
// so storage-backed code under test sees `undefined`. Install a working
// in-memory implementation. (No-op effect where jsdom's storage already works.)
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  const api = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(String(key)) ? (store.get(String(key)) as string) : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(String(key))
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value))
    },
  }
  // Proxy so bracket/property access (storage['k'], storage.k) hits the same
  // backing store as the method API, matching the real Storage index signature.
  // Known members and symbols pass through to the method API; anything else is
  // treated as a stored key.
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target) {
        return Reflect.get(target, prop, receiver)
      }
      return store.has(prop) ? store.get(prop) : undefined
    },
    set(target, prop, value, receiver) {
      if (typeof prop === 'symbol' || prop in target) {
        return Reflect.set(target, prop, value, receiver)
      }
      store.set(prop, String(value))
      return true
    },
    has(target, prop) {
      return prop in target || (typeof prop === 'string' && store.has(prop))
    },
    deleteProperty(target, prop) {
      if (typeof prop === 'string' && store.has(prop)) {
        store.delete(prop)
        return true
      }
      return Reflect.deleteProperty(target, prop)
    },
    ownKeys() {
      return Array.from(store.keys())
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && store.has(prop)) {
        return {
          configurable: true,
          enumerable: true,
          value: store.get(prop),
          writable: true,
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
  }) as Storage
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const existing = (globalThis as Record<string, unknown>)[name]
  const usable = existing != null && typeof (existing as Storage).clear === 'function'
  if (usable) continue
  try {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: createMemoryStorage(),
    })
  } catch {
    try {
      ;(globalThis as Record<string, unknown>)[name] = createMemoryStorage()
    } catch {
      /* native global is locked; leave as-is */
    }
  }
}

// Vitest reuses workers across files, so a single storage instance can persist
// between test files. Clear it at the start of each file so state never bleeds
// across files. (Within a file, suites still isolate via their own beforeEach.)
beforeAll(() => {
  try {
    globalThis.localStorage?.clear()
  } catch {
    /* ignore */
  }
  try {
    globalThis.sessionStorage?.clear()
  } catch {
    /* ignore */
  }
})
