import '@testing-library/jest-dom/vitest'

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
// in-memory implementation. (No-op effect on CI's Node 22, which uses jsdom's.)
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  } as Storage
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const existing = (globalThis as Record<string, unknown>)[name]
  const usable =
    existing != null && typeof (existing as Storage).clear === 'function'
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
