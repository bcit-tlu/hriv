import { ApiError, userMessage } from './api'

const PASSWORD_ERROR_MESSAGES: Record<string, string> = {
  account_inactive:
    'Account has been disabled. Please contact the TLU Learning Tech Lab via Teams to activate your account.',
  password_already_set: 'A password is already set for this account — sign in instead',
  password_unchanged: 'Choose a different password from your current password.',
  oidc_linked: 'Your password is managed by your identity provider. Use single sign-on instead.',
}

export function passwordErrorMessage(error: unknown, setup = false): string {
  if (error instanceof ApiError) {
    if (PASSWORD_ERROR_MESSAGES[error.detail]) return PASSWORD_ERROR_MESSAGES[error.detail]
    if (error.status === 401)
      return setup
        ? 'This link has expired or was already replaced — ask your administrator for a new one'
        : 'Your current password is incorrect. Please try again.'
    if (error.status === 409 && setup) return PASSWORD_ERROR_MESSAGES.password_already_set
    if (error.status === 429) return 'Too many attempts. Please try again later.'
    if (error.status === 422)
      return 'Use a password with at least 8 characters and at most 72 UTF-8 bytes.'
  }
  return userMessage(error, 'Unable to update your password. Please try again.')
}

export function newPasswordError(password: string, confirm: string): string | null {
  if (Array.from(password).length < 8) return 'Use at least 8 characters.'
  if (new TextEncoder().encode(password).length > 72) return 'Use at most 72 UTF-8 bytes.'
  if (password !== confirm) return 'Passwords do not match.'
  return null
}
