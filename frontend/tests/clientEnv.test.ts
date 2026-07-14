import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectClientEnv } from '../src/clientEnv'

function stubEnv(ua: string, opts: { width?: number; maxTouchPoints?: number } = {}): void {
  vi.stubGlobal('navigator', {
    userAgent: ua,
    maxTouchPoints: opts.maxTouchPoints ?? 0,
  })
  vi.stubGlobal('window', {
    innerWidth: opts.width ?? 1280,
  })
}

describe('detectClientEnv', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies a desktop Chrome on Windows', () => {
    stubEnv(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      { width: 1440 },
    )
    expect(detectClientEnv()).toEqual({
      browser_family: 'chrome',
      browser_major: '128',
      os_family: 'windows',
      device_class: 'desktop',
      viewport_bucket: 'lg',
      touch_capable: false,
    })
  })

  it('classifies Safari on an iPhone as mobile with touch', () => {
    stubEnv(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      { width: 390, maxTouchPoints: 5 },
    )
    const env = detectClientEnv()
    expect(env?.os_family).toBe('ios')
    expect(env?.device_class).toBe('mobile')
    expect(env?.touch_capable).toBe(true)
    expect(env?.viewport_bucket).toBe('xs')
  })

  it('detects Edge before Chrome and Firefox correctly', () => {
    stubEnv(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
    )
    expect(detectClientEnv()?.browser_family).toBe('edge')

    stubEnv('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', {
      width: 800,
    })
    const firefox = detectClientEnv()
    expect(firefox?.browser_family).toBe('firefox')
    expect(firefox?.os_family).toBe('linux')
    expect(firefox?.viewport_bucket).toBe('sm')
  })

  it('buckets viewports across the breakpoints', () => {
    const widths: Array<[number, string]> = [
      [500, 'xs'],
      [700, 'sm'],
      [1000, 'md'],
      [1300, 'lg'],
      [1920, 'xl'],
    ]
    for (const [width, bucket] of widths) {
      stubEnv('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { width })
      expect(detectClientEnv()?.viewport_bucket).toBe(bucket)
    }
  })

  it('returns null outside a browser environment', () => {
    vi.stubGlobal('navigator', undefined)
    vi.stubGlobal('window', undefined)
    expect(detectClientEnv()).toBeNull()
  })
})
