/**
 * Bounded, low-cardinality client-environment detection for usage telemetry.
 *
 * Everything here is deliberately reduced to a small, enumerated set of
 * buckets so decision-maker analytics stay privacy-preserving and low
 * cardinality. We never emit the raw user-agent string, screen dimensions, or
 * any other value that could fingerprint or identify an individual. The
 * backend independently re-bounds these values against allowlists, so this is
 * a best-effort classifier, not a trust boundary.
 */

export type BrowserFamily = 'chrome' | 'firefox' | 'safari' | 'edge' | 'opera' | 'samsung' | 'other'
export type OsFamily = 'windows' | 'macos' | 'ios' | 'android' | 'linux' | 'chromeos' | 'other'
export type DeviceClass = 'desktop' | 'mobile' | 'tablet' | 'other'
export type ViewportBucket = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface ClientEnv {
  browser_family: BrowserFamily
  browser_major?: string
  os_family: OsFamily
  device_class: DeviceClass
  viewport_bucket: ViewportBucket
  touch_capable: boolean
}

function detectBrowser(ua: string): { family: BrowserFamily; major?: string } {
  // Order matters: Edge/Opera/Samsung UAs also contain "Chrome"/"Safari".
  const patterns: Array<{ family: BrowserFamily; re: RegExp }> = [
    { family: 'edge', re: /Edg(?:e|A|iOS)?\/(\d+)/ },
    { family: 'opera', re: /(?:OPR|Opera)\/(\d+)/ },
    { family: 'samsung', re: /SamsungBrowser\/(\d+)/ },
    { family: 'firefox', re: /(?:Firefox|FxiOS)\/(\d+)/ },
    { family: 'chrome', re: /(?:Chrome|CriOS)\/(\d+)/ },
    { family: 'safari', re: /Version\/(\d+).*Safari/ },
  ]
  for (const { family, re } of patterns) {
    const m = ua.match(re)
    if (m) return { family, major: m[1] }
  }
  return { family: 'other' }
}

function detectOs(ua: string): OsFamily {
  if (/Windows/.test(ua)) return 'windows'
  if (/CrOS/.test(ua)) return 'chromeos'
  if (/Android/.test(ua)) return 'android'
  if (/(iPhone|iPad|iPod)/.test(ua)) return 'ios'
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos'
  if (/Linux/.test(ua)) return 'linux'
  return 'other'
}

function detectDeviceClass(ua: string, touch: boolean): DeviceClass {
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) {
    return 'tablet'
  }
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'mobile'
  if (touch && /Macintosh/.test(ua)) return 'tablet' // iPadOS masquerades as macOS
  return 'desktop'
}

function detectViewportBucket(width: number): ViewportBucket {
  // Aligned with common Material UI breakpoints.
  if (width < 600) return 'xs'
  if (width < 900) return 'sm'
  if (width < 1200) return 'md'
  if (width < 1536) return 'lg'
  return 'xl'
}

/**
 * Compute the current bounded client environment. Returns `null` outside a
 * browser (tests, SSR) so callers can skip attaching environment fields.
 */
export function detectClientEnv(): ClientEnv | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return null
  }
  const ua = navigator.userAgent ?? ''
  const touch =
    (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window
  const { family, major } = detectBrowser(ua)
  return {
    browser_family: family,
    browser_major: major,
    os_family: detectOs(ua),
    device_class: detectDeviceClass(ua, touch),
    viewport_bucket: detectViewportBucket(window.innerWidth || 0),
    touch_capable: touch,
  }
}
