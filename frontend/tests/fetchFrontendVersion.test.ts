/**
 * Unit tests for ``fetchFrontendVersion`` in ``src/api.ts``.
 *
 * The frontend's displayed version is not baked into the Vite bundle
 * as ``import.meta.env.VITE_APP_VERSION`` (which would survive
 * ``release-retag.yaml``'s digest-promotion and leak the main-build
 * ``-rc.<short>`` string into production pulls).  Instead the
 * deployed nginx serves a ``/version`` endpoint rendered at container
 * start from the Helm-injected ``APP_VERSION`` env var, and the
 * admin footer fetches it on mount.
 *
 * These tests cover the three externally-visible behaviours of the
 * fetch helper:
 *   1. Success → JSON body is returned verbatim as
 *      ``{frontend: "<ver>"}``.
 *   2. Non-``ok`` HTTP response → rejection carrying the status code,
 *      so the ``App.tsx`` effect can fall back to ``"dev"``.
 *   3. Network error (``fetch`` itself rejects) → propagated rejection,
 *      same fallback path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ``api.ts`` module-load side effects: ``localStorage.getItem('hriv_token')``
// and ``crypto.randomUUID()`` for the session id. Stub both so the
// module initializes cleanly under vitest's jsdom / happy-dom env.
const storage: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, val: string) => {
    storage[key] = val
  },
  removeItem: (key: string) => {
    delete storage[key]
  },
})
vi.stubGlobal('crypto', { randomUUID: () => 'test-session-id' })

import { fetchFrontendVersion } from '../src/api'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

function errorResponse(status: number, statusText: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(statusText),
  })
}

describe('fetchFrontendVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GETs /version (outside the /api prefix) and returns the parsed body', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ frontend: '1.1.18-rc.b286051' }))

    const result = await fetchFrontendVersion()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    // Must NOT be prefixed with /api — the endpoint is served by the
    // frontend's own nginx, not proxied through to the backend.
    expect(url).toBe('/version')
    expect(init?.headers?.Accept).toBe('application/json')
    // No Authorization header: the endpoint is intentionally
    // unauthenticated (the JS bundle filename hashes already leak the
    // same tag-identity information to any unauthenticated client).
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(result).toEqual({ frontend: '1.1.18-rc.b286051' })
  })

  it('returns clean release strings unchanged (retag-promoted images)', async () => {
    // When release-retag.yaml promotes a main-build digest to a clean
    // vX.Y.Z tag, flux-fleet's ImagePolicy writes the release tag into
    // .Values.image.tag, the Helm helper passes it through unchanged
    // (no -rc.<ts>. segment to strip), nginx's envsubst substitutes
    // that string into the response body, and this helper surfaces it
    // verbatim — the whole point of the build-vs-display-identity
    // split introduced in this PR.
    mockFetch.mockReturnValueOnce(jsonResponse({ frontend: '1.1.18' }))

    const result = await fetchFrontendVersion()

    expect(result).toEqual({ frontend: '1.1.18' })
  })

  it('rejects with the HTTP status on non-ok responses', async () => {
    mockFetch.mockReturnValueOnce(errorResponse(404, 'Not Found'))

    await expect(fetchFrontendVersion()).rejects.toThrow('Frontend /version 404')
  })

  it('propagates network errors so callers can fall back to "dev"', async () => {
    // ``npm run dev`` does not serve /version — Vite's proxy only
    // forwards /api — so the fetch call itself rejects. App.tsx's
    // catch handler treats this as "frontend: dev".
    mockFetch.mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')))

    await expect(fetchFrontendVersion()).rejects.toThrow('Failed to fetch')
  })
})
