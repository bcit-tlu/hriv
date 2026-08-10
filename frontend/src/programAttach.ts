import type { User } from './types'

export function getAttachableProgramIds(
  user: Pick<User, 'role' | 'program_ids'> | null,
): number[] | null {
  return user?.role === 'instructor' ? user.program_ids : null
}
