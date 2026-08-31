import '@testing-library/jest-dom/vitest'
import { beforeAll } from 'vitest'

// Node >= 26 emits an ExperimentalWarning the first time the native
// `localStorage`/`sessionStorage` global is *accessed* without the
// `--localstorage-file` flag. The storage shim below reads those globals to
// decide whether it needs to install an in-memory fallback, and that read
// alone trips the warning — once per test file, flooding `npm run test`
// output with what looks like errors. Filter out just that one warning here;
// every other warning is forwarded to Node untouched. (No-op on CI's Node 22,
// which doesn't have the native global and never emits it.)
const originalEmitWarning = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning.message
  // Match narrowly on BOTH tokens of the known Node message so unrelated
  // future warnings that merely mention the flag aren't silently swallowed.
  if (message.includes('localStorage') && message.includes('--localstorage-file')) return
  ;(originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning

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
// between test files. Clear it once at the start of each file so state never
// bleeds across files. (Within a file, suites still isolate via their own
// beforeEach, matching real jsdom semantics.)
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
