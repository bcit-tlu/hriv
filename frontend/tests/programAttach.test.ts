import { describe, it, expect } from 'vitest'
import { getAttachableProgramIds } from '../src/programAttach'

describe('getAttachableProgramIds', () => {
  it('returns program_ids for instructors', () => {
    expect(getAttachableProgramIds({ role: 'instructor', program_ids: [1, 2] })).toEqual([1, 2])
  })

  it('returns null for admins', () => {
    expect(getAttachableProgramIds({ role: 'admin', program_ids: [1, 2] })).toBeNull()
  })

  it('returns null for students (they never reach these dialogs)', () => {
    expect(getAttachableProgramIds({ role: 'student', program_ids: [1, 2] })).toBeNull()
  })

  it('returns null when there is no auth user', () => {
    expect(getAttachableProgramIds(null)).toBeNull()
  })
})
