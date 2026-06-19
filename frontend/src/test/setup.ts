import '@testing-library/jest-dom/vitest'

// @dnd-kit/dom requires ResizeObserver which jsdom does not provide.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}
