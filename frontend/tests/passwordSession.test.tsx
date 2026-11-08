import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AuthContextValue } from '../src/authContextValue'

vi.mock('../src/observability', () => ({ emitEventNow: vi.fn() }))

const user = {
  id: 7,
  name: 'Guest',
  email: 'guest@example.invalid',
  role: 'student',
  active: true,
  has_local_password: true,
  oidc_linked: false,
  must_change_password: false,
  program_ids: [],
  program_names: [],
  group_ids: [],
  group_names: [],
  last_access: null,
  metadata_extra: null,
  created_at: '',
  updated_at: '',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let ctx: AuthContextValue
let previousUrl: string

beforeEach(() => {
  previousUrl = window.location.href
  vi.resetModules()
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', previousUrl)
})

async function mount() {
  const { default: AuthProvider } = await import('../src/AuthContext')
  const { useAuth } = await import('../src/useAuth')
  function Shell() {
    ctx = useAuth()
    if (ctx.loading) return <div role="status">Loading session</div>
    return (
      <nav aria-label="Application">
        <span>{ctx.currentUser?.name ?? 'Signed out'}</span>
      </nav>
    )
  }
  render(
    <AuthProvider>
      <Shell />
    </AuthProvider>,
  )
}

function fillChange() {
  fireEvent.change(screen.getByLabelText(/^Current password/), {
    target: { value: 'old-password' },
  })
  fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'new-password' } })
  fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
    target: { value: 'new-password' },
  })
}

function expectCachedProfileWithoutPasswordFlags() {
  const cached = JSON.parse(localStorage.getItem('hriv_user')!)
  expect(cached).not.toHaveProperty('has_local_password')
  expect(cached).not.toHaveProperty('must_change_password')
  expect(cached).toMatchObject({ id: user.id, name: user.name, email: user.email })
}

describe('password session routing', () => {
  it.each([200, 401])(
    'ignores a stale admin user-list response (%s) after setup redemption',
    async (status) => {
      const admin = { ...user, name: 'Old admin', role: 'admin' }
      localStorage.setItem('hriv_token', 'old-admin-session')
      localStorage.setItem('hriv_user', JSON.stringify(admin))
      let resolveUsers!: (response: Response) => void
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/auth/me')) return Promise.resolve(json(admin))
        if (url.includes('/users'))
          return new Promise<Response>((resolve) => {
            resolveUsers = resolve
          })
        return Promise.resolve(json({ access_token: 'guest-session', token_type: 'bearer', user }))
      })
      vi.stubGlobal('fetch', fetchMock)
      await mount()
      await waitFor(() => expect(resolveUsers).toBeTypeOf('function'))
      expect(screen.getByRole('navigation')).toHaveTextContent('Old admin')
      await act(() => {
        window.history.replaceState({}, '', '/#password_setup=guest-setup')
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })
      fireEvent.change(screen.getByLabelText(/^New password/), {
        target: { value: 'new-password' },
      })
      fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
        target: { value: 'new-password' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
      expect(await screen.findByRole('navigation')).toHaveTextContent('Guest')
      await act(async () => {
        resolveUsers(
          status === 200 ? json([admin]) : json({ detail: 'Invalid or expired token' }, status),
        )
      })
      expect(screen.getByRole('navigation')).toHaveTextContent('Guest')
      expect(localStorage.getItem('hriv_token')).toBe('guest-session')
      expect(JSON.parse(localStorage.getItem('hriv_user')!).id).toBe(user.id)
      expect(ctx.users).toEqual([])
      expect(ctx.loading).toBe(false)
    },
  )

  it('captures a same-document setup link, cleans the URL and discards the old session', async () => {
    localStorage.setItem('hriv_token', 'old-session')
    localStorage.setItem('hriv_user', JSON.stringify(user))
    const fetchMock = vi.fn().mockResolvedValue(json(user))
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    expect(await screen.findByRole('navigation')).toHaveTextContent('Guest')
    fetchMock.mockClear()
    await act(() => {
      window.history.replaceState(
        {},
        '',
        '/?keep=1#password_setup=new-token&view=remaining&oidc_token=ignored',
      )
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(window.location.hash).toBe('#view=remaining')
    expect(window.location.search).toBe('?keep=1')
    expect(localStorage.getItem('hriv_token')).toBeNull()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fetchMock.mockResolvedValue(json({ access_token: 'new-session', token_type: 'bearer', user }))
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
      target: { value: 'new-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByRole('navigation')).toHaveTextContent('Guest')
    expect(localStorage.getItem('hriv_token')).toBe('new-session')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/auth/password-setup'),
      expect.objectContaining({
        body: JSON.stringify({ token: 'new-token', password: 'new-password' }),
      }),
    )
  })

  it('does not restore an in-flight old session after same-document setup navigation', async () => {
    localStorage.setItem('hriv_token', 'old-session')
    localStorage.setItem('hriv_user', JSON.stringify(user))
    let resolveSession!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveSession = resolve
          }),
      ),
    )
    await mount()
    await act(() => {
      window.history.replaceState({}, '', '/#password_setup=new-token')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await act(async () => {
      resolveSession(json(user))
    })
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument()
    expect(localStorage.getItem('hriv_token')).toBeNull()
    expect(localStorage.getItem('hriv_user')).toBeNull()
  })

  it('captures and cleans the fragment, redeems once and establishes the returned session', async () => {
    window.history.replaceState({}, '', '/?keep=1#password_setup=setup-token&view=remaining')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ access_token: 'session-token', token_type: 'bearer', user }))
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    expect(window.location.hash).toBe('#view=remaining')
    expect(window.location.search).toBe('?keep=1')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
      target: { value: 'new-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(await screen.findByRole('navigation')).toHaveTextContent('Guest')
    expect(localStorage.getItem('hriv_token')).toBe('session-token')
    expectCachedProfileWithoutPasswordFlags()
    expect(ctx.currentUser?.has_local_password).toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/auth/password-setup'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'setup-token', password: 'new-password' }),
      }),
    )
  })

  it('discards an existing session for setup and can return to sign in', async () => {
    localStorage.setItem('hriv_token', 'old-session')
    localStorage.setItem('hriv_user', JSON.stringify(user))
    window.history.replaceState({}, '', '/#password_setup=setup-token&oidc_token=other-token')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    expect(window.location.hash).toBe('')
    expect(localStorage.getItem('hriv_token')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }))
    expect(await screen.findByRole('navigation')).toHaveTextContent('Signed out')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gates flagged login, refreshes /auth/me after change and restores navigation', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/login'))
        return Promise.resolve(
          json({
            access_token: 'session-token',
            token_type: 'bearer',
            user: { ...user, must_change_password: true },
          }),
        )
      if (url.endsWith('/auth/change-password'))
        return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(json(user))
    })
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    await act(() => ctx.login('guest@example.invalid', 'old-password'))
    expect(screen.getByRole('heading', { name: 'Change your password' })).toBeInTheDocument()
    expectCachedProfileWithoutPasswordFlags()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    fillChange()
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('navigation')).toHaveTextContent('Guest')
    expect(await screen.findByText('Password changed successfully.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/me'), expect.anything())
    expectCachedProfileWithoutPasswordFlags()
    expect(ctx.currentUser?.must_change_password).toBe(false)
  })

  it('waits for /auth/me before exposing navigation when cached password flags are absent', async () => {
    const cached = { ...user, has_local_password: undefined, must_change_password: undefined }
    localStorage.setItem('hriv_token', 'session-token')
    localStorage.setItem('hriv_user', JSON.stringify(cached))
    let resolveSession!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveSession = resolve
          }),
      ),
    )
    await mount()
    expect(screen.getByRole('status')).toHaveTextContent('Loading session')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(ctx.currentUser).toBeNull()
    await act(async () => {
      resolveSession(json({ ...user, must_change_password: true }))
    })
    expect(screen.getByRole('heading', { name: 'Change your password' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expectCachedProfileWithoutPasswordFlags()
  })

  it('tolerates omitted password flags without trusting the cached profile', async () => {
    const profile = { ...user, has_local_password: undefined, must_change_password: undefined }
    localStorage.setItem('hriv_token', 'session-token')
    localStorage.setItem('hriv_user', JSON.stringify(profile))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(profile)))
    await mount()
    expect(await screen.findByRole('navigation')).toHaveTextContent('Guest')
    expect(ctx.currentUser).toMatchObject({
      has_local_password: false,
      must_change_password: false,
    })
    expectCachedProfileWithoutPasswordFlags()
  })

  it('revalidates a stored session and gates a flag set while signed out of the tab', async () => {
    localStorage.setItem('hriv_token', 'session-token')
    localStorage.setItem('hriv_user', JSON.stringify(user))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...user, must_change_password: true })))
    await mount()
    expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('navigation')).toHaveTextContent('Signed out')
    expect(localStorage.getItem('hriv_token')).toBeNull()
  })

  it('routes a mid-session 403 centrally but ignores other 403s', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ access_token: 'session-token', token_type: 'bearer', user }))
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    await act(() => ctx.login('guest@example.invalid', 'old-password'))
    const { fetchUsers } = await import('../src/api')
    fetchMock.mockResolvedValueOnce(json({ detail: 'Forbidden' }, 403))
    await act(async () => {
      await expect(fetchUsers()).rejects.toThrow('Forbidden')
    })
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    fetchMock.mockResolvedValueOnce(json({ detail: 'password_change_required' }, 403))
    await act(async () => {
      await expect(fetchUsers()).rejects.toThrow('password_change_required')
    })
    expect(screen.getByRole('heading', { name: 'Change your password' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('maps flags centrally and defaults omitted directory flags to false', async () => {
    const { toUser } = await import('../src/api')
    expect(toUser({ ...user, oidc_linked: true, must_change_password: true })).toMatchObject({
      has_local_password: true,
      oidc_linked: true,
      must_change_password: true,
    })
    expect(
      toUser({
        ...user,
        has_local_password: undefined,
        oidc_linked: undefined,
        must_change_password: undefined,
      }),
    ).toMatchObject({ has_local_password: false, oidc_linked: false, must_change_password: false })
  })
})
