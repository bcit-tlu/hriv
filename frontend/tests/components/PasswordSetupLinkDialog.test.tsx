import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PasswordSetupLinkDialog from '../../src/components/PasswordSetupLinkDialog'
import { ApiError, mintPasswordSetupLink } from '../../src/api'

vi.mock('../../src/api', async (original) => ({
  ...(await original<typeof import('../../src/api')>()),
  mintPasswordSetupLink: vi.fn(),
}))
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(mintPasswordSetupLink).mockReset()
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
  else Reflect.deleteProperty(document, 'execCommand')
})
const user = { id: 9, name: 'Guest', active: true }
const response = { setup_token: 'test-token', expires_at: '2030-01-02T12:00:00Z' }

describe('PasswordSetupLinkDialog', () => {
  it('starts with the original execCommand property', () => {
    expect(Object.getOwnPropertyDescriptor(document, 'execCommand')).toEqual(originalExecCommand)
  })
  it('composes the URL, shows local expiry and copies without persisting it', async () => {
    vi.mocked(mintPasswordSetupLink).mockResolvedValue(response)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const close = vi.fn()
    render(<PasswordSetupLinkDialog user={user} onClose={close} />)
    const url = `${window.location.origin}/#password_setup=test-token`
    expect(await screen.findByLabelText('Setup URL')).toHaveValue(url)
    expect(
      screen.getByText(`Expires: ${new Date(response.expires_at).toLocaleString()}`),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText('Link copied to clipboard.')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(url)
    expect(storage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('retries a mint error without retaining a previous link', async () => {
    vi.mocked(mintPasswordSetupLink)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(response)
    render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    expect(
      await screen.findByText(
        'Could not create a setup link. Retry here or from the person’s row.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Setup URL')).toBeInTheDocument()
    expect(mintPasswordSetupLink).toHaveBeenCalledTimes(2)
  })

  it.each([
    [403, 'account_inactive', 'Activate this account'],
    [422, 'oidc_linked', 'Managed by'],
    [409, 'password_already_set', 'Clear it before'],
  ])('maps mint error %s', async (status, detail, copy) => {
    vi.mocked(mintPasswordSetupLink).mockRejectedValue(
      new ApiError(status as number, detail as string),
    )
    render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    expect(await screen.findByText(new RegExp(copy as string))).toBeInTheDocument()
    expect(screen.queryByLabelText('Setup URL')).not.toBeInTheDocument()
  })

  it('offers a new link only on demand after clearing, and blocks inactive accounts', async () => {
    vi.mocked(mintPasswordSetupLink).mockResolvedValue(response)
    const { unmount } = render(
      <PasswordSetupLinkDialog user={user} passwordCleared onClose={vi.fn()} />,
    )
    expect(mintPasswordSetupLink).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create setup link' }))
    expect(await screen.findByLabelText('Setup URL')).toBeInTheDocument()
    unmount()
    vi.mocked(mintPasswordSetupLink).mockClear()
    render(<PasswordSetupLinkDialog user={{ ...user, active: false }} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Create setup link' })).toBeDisabled()
    expect(mintPasswordSetupLink).not.toHaveBeenCalled()
  })

  it('waits for a closed dialog’s mint to settle before minting a replacement on reopen', async () => {
    let resolve!: (value: typeof response) => void
    vi.mocked(mintPasswordSetupLink)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        }),
      )
      .mockResolvedValue({ ...response, setup_token: 'new-token' })
    const { unmount } = render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    unmount()
    render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(mintPasswordSetupLink).toHaveBeenCalledOnce()
    await act(async () => resolve(response))
    expect(await screen.findByLabelText('Setup URL')).toHaveValue(
      `${window.location.origin}/#password_setup=new-token`,
    )
    expect(mintPasswordSetupLink).toHaveBeenCalledTimes(2)
  })

  it('releases the per-user mint lock on failure and skips closed waiters', async () => {
    let reject!: (error: Error) => void
    vi.mocked(mintPasswordSetupLink)
      .mockReturnValueOnce(
        new Promise((_, fail) => {
          reject = fail
        }),
      )
      .mockResolvedValue(response)
    const first = render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    first.unmount()
    const second = render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    second.unmount()
    render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    expect(mintPasswordSetupLink).toHaveBeenCalledOnce()
    await act(async () => reject(new Error('offline')))
    expect(await screen.findByLabelText('Setup URL')).toBeInTheDocument()
    expect(mintPasswordSetupLink).toHaveBeenCalledTimes(2)
  })

  it('does not block minting for a different person', async () => {
    let resolve!: (value: typeof response) => void
    vi.mocked(mintPasswordSetupLink)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        }),
      )
      .mockResolvedValue(response)
    const first = render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    first.unmount()
    render(<PasswordSetupLinkDialog user={{ ...user, id: 10 }} onClose={vi.fn()} />)
    expect(await screen.findByLabelText('Setup URL')).toBeInTheDocument()
    expect(mintPasswordSetupLink).toHaveBeenCalledTimes(2)
    await act(async () => resolve(response))
  })

  it('falls back to selecting the URL for copy and shows a useful error when copying fails', async () => {
    vi.mocked(mintPasswordSetupLink).mockResolvedValue(response)
    vi.stubGlobal('navigator', {})
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    })
    render(<PasswordSetupLinkDialog user={user} onClose={vi.fn()} />)
    await screen.findByLabelText('Setup URL')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText(/Select the URL and copy it manually/)).toBeInTheDocument()
    expect(document.body.querySelector('input')).toBeNull()
    await waitFor(() => expect(mintPasswordSetupLink).toHaveBeenCalledOnce())
  })
})
