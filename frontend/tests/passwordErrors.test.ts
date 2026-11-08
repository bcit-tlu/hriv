import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api'
import { newPasswordError, passwordErrorMessage } from '../src/passwordErrors'

describe('password validation and error copy', () => {
  it.each([
    ['', '', 'at least 8'],
    ['1234567', '1234567', 'at least 8'],
    ['12345678', 'different', 'do not match'],
    ['é'.repeat(37), 'é'.repeat(37), '72 UTF-8'],
    ['😀'.repeat(7), '😀'.repeat(7), 'at least 8'],
  ])('rejects invalid password/confirmation', (password, confirm, message) => {
    expect(newPasswordError(password, confirm)).toContain(message)
  })
  it.each(['12345678', 'a'.repeat(72), 'é'.repeat(36)])('accepts valid boundaries', (password) => {
    expect(newPasswordError(password, password)).toBeNull()
  })
  it.each([
    [401, 'invalid_token', true, 'This link has expired or was already replaced'],
    [403, 'account_inactive', true, 'Account has been disabled.'],
    [409, 'password_already_set', true, 'A password is already set'],
    [429, 'rate_limited', true, 'Too many attempts.'],
    [422, 'validation', true, 'at least 8 characters'],
    [401, 'Invalid current password', false, 'current password is incorrect'],
    [403, 'oidc_linked', false, 'identity provider'],
    [422, 'password_unchanged', false, 'different password'],
    [429, 'rate_limited', false, 'Too many attempts.'],
    [500, '', false, 'Unable to update your password.'],
  ] as const)('maps status %s / %s', (status, detail, setup, message) => {
    expect(passwordErrorMessage(new ApiError(status, detail), setup)).toContain(message)
  })
})
