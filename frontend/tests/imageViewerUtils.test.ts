/**
 * Unit tests for `memoizeWebGLDrawerSupport`.
 *
 * OpenSeadragon's WebGLDrawer.isSupported() probe creates and releases a real
 * WebGL context on every Viewer construction (main viewer and navigator
 * minimap), producing a "WebGL context was lost" console warning each time.
 * The memoized wrapper must run the underlying probe at most once while
 * preserving the false-retry behaviour.
 */

import { describe, expect, it, vi } from 'vitest'

import { memoizeWebGLDrawerSupport } from '../src/components/imageViewerUtils'

describe('memoizeWebGLDrawerSupport', () => {
  it('is a no-op for a missing drawer class', () => {
    expect(() => memoizeWebGLDrawerSupport(undefined)).not.toThrow()
    expect(() => memoizeWebGLDrawerSupport(null)).not.toThrow()
  })

  it('caches a successful probe so it only runs once', () => {
    const WebGLDrawer = { isSupported: vi.fn(() => true) }
    memoizeWebGLDrawerSupport(WebGLDrawer)

    expect(WebGLDrawer.isSupported()).toBe(true)
    expect(WebGLDrawer.isSupported()).toBe(true)
    expect(WebGLDrawer.isSupported()).toBe(true)
  })

  it('calls the original probe exactly once after success', () => {
    const original = vi.fn(() => true)
    const WebGLDrawer = { isSupported: original }
    memoizeWebGLDrawerSupport(WebGLDrawer)

    WebGLDrawer.isSupported()
    WebGLDrawer.isSupported()
    WebGLDrawer.isSupported()
    expect(original).toHaveBeenCalledTimes(1)
  })

  it('does not cache a false verdict', () => {
    const original = vi.fn<() => boolean>().mockReturnValueOnce(false).mockReturnValue(true)
    const WebGLDrawer = { isSupported: original }
    memoizeWebGLDrawerSupport(WebGLDrawer)

    expect(WebGLDrawer.isSupported()).toBe(false)
    expect(WebGLDrawer.isSupported()).toBe(true)
    expect(WebGLDrawer.isSupported()).toBe(true)
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('does not wrap the same drawer class twice', () => {
    const original = vi.fn(() => true)
    const WebGLDrawer = { isSupported: original }
    memoizeWebGLDrawerSupport(WebGLDrawer)
    const wrapped = WebGLDrawer.isSupported
    memoizeWebGLDrawerSupport(WebGLDrawer)

    expect(WebGLDrawer.isSupported).toBe(wrapped)
    WebGLDrawer.isSupported()
    expect(original).toHaveBeenCalledTimes(1)
  })

  it('forwards the drawer options argument to the original probe', () => {
    const original = vi.fn(() => true)
    const WebGLDrawer: { isSupported: (options?: unknown) => boolean } = {
      isSupported: original,
    }
    memoizeWebGLDrawerSupport(WebGLDrawer)

    const options = { unpackWithPremultipliedAlpha: true }
    WebGLDrawer.isSupported(options)
    expect(original).toHaveBeenCalledWith(options)
  })
})
