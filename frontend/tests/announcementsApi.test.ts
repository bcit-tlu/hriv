import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addAnnouncementReaction,
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncementBroadcast,
  fetchAnnouncements,
  markAnnouncementSeen,
  removeAnnouncementReaction,
  updateAnnouncement,
  uploadMedia,
} from '../src/api'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    })
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1] as [string, RequestInit]
  return { url, init }
}

describe('announcements API wrappers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the inbox by default and the mine scope on request', async () => {
    mockFetch.mockImplementation(jsonResponse([]))
    await fetchAnnouncements()
    expect(lastCall().url).toMatch(/\/announcements\/\?scope=inbox$/)
    await fetchAnnouncements('mine')
    expect(lastCall().url).toMatch(/\/announcements\/\?scope=mine$/)
  })

  it('fetches the login broadcast', async () => {
    mockFetch.mockImplementation(jsonResponse([]))
    await fetchAnnouncementBroadcast()
    expect(lastCall().url).toMatch(/\/announcements\/broadcast$/)
  })

  it('creates and updates with JSON bodies, passing notify_again through', async () => {
    mockFetch.mockImplementation(jsonResponse({ id: 5 }))
    await createAnnouncement({ title: 'T', message: 'M', kind: 'notice', audience: 'everyone' })
    expect(lastCall().init.method).toBe('POST')
    expect(JSON.parse(String(lastCall().init.body))).toMatchObject({ audience: 'everyone' })

    await updateAnnouncement(5, { title: 'T2', notify_again: true })
    expect(lastCall().url).toMatch(/\/announcements\/5$/)
    expect(lastCall().init.method).toBe('PATCH')
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ title: 'T2', notify_again: true })
  })

  it('deletes and marks seen with the right verbs', async () => {
    mockFetch.mockImplementation(jsonResponse(undefined, 204))
    await deleteAnnouncement(9)
    expect(lastCall()).toMatchObject({ init: { method: 'DELETE' } })
    expect(lastCall().url).toMatch(/\/announcements\/9$/)
    await markAnnouncementSeen(9)
    expect(lastCall().url).toMatch(/\/announcements\/9\/seen$/)
    expect(lastCall().init.method).toBe('PUT')
  })

  it('adds and removes reactions with URL-encoded emoji ids', async () => {
    mockFetch.mockImplementation(jsonResponse({ reactions: { '+1': 1 }, my_reactions: ['+1'] }))
    await addAnnouncementReaction(2, '+1')
    expect(lastCall().url).toMatch(/\/announcements\/2\/reactions\/%2B1$/)
    expect(lastCall().init.method).toBe('PUT')
    await removeAnnouncementReaction(2, 'heart')
    expect(lastCall().url).toMatch(/\/announcements\/2\/reactions\/heart$/)
    expect(lastCall().init.method).toBe('DELETE')
  })

  it('uploads media as multipart form data', async () => {
    mockFetch.mockImplementation(jsonResponse({ id: 1 }, 201))
    await uploadMedia(new File(['x'], 'slide.png', { type: 'image/png' }))
    const { url, init } = lastCall()
    expect(url).toMatch(/\/media\/$/)
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    // The browser must set the multipart boundary itself.
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain('Content-Type')
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
  })
})
