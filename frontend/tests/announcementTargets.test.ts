import { describe, expect, it } from 'vitest'
import type { ApiGroup, ApiProgram } from '../src/api'
import {
  RESERVED_PROGRAM_NAMES,
  buildTargetOptions,
  initialComposerState,
} from '../src/announcementUtils'
import { makeAnnouncement } from './announcementFixtures'

const programs = [
  { id: 1, name: 'Administration' },
  { id: 2, name: 'Synthetic Monitoring' },
  { id: 3, name: 'Histotech' },
] as ApiProgram[]
const groups = [] as ApiGroup[]

describe('buildTargetOptions', () => {
  it('hides reserved programs from the To: picker', () => {
    expect([...RESERVED_PROGRAM_NAMES]).toContain('Synthetic Monitoring')
    const labels = buildTargetOptions(programs, groups, true).map((o) => o.label)
    expect(labels).toContain('Histotech')
    expect(labels).not.toContain('Administration')
    expect(labels).not.toContain('Synthetic Monitoring')
    // The admin team's program is offered under the Audience group, pluralised.
    const admins = buildTargetOptions(programs, [], true).find((o) => o.label === 'Admins')
    expect(admins).toMatchObject({ kind: 'program', id: 1, group: 'Audience' })
  })

  it('offers every role audience to admins only, in picker order', () => {
    expect(
      buildTargetOptions(programs, groups, true)
        .filter((o) => o.kind === 'audience')
        .map((o) => o.id),
    ).toEqual(['everyone', 'staff', 'instructors', 'staff_only'])
    expect(buildTargetOptions(programs, groups, false).some((o) => o.kind === 'audience')).toBe(
      false,
    )
  })

  it('keeps a stored admin-role audience selected when editing even though the picker no longer offers it', () => {
    const options = buildTargetOptions(programs, [], true)
    const source = makeAnnouncement({ audience: 'admins', program_ids: [], group_ids: [] })
    const state = initialComposerState({ source, mode: 'edit', options, kinds: [], isAdmin: true })
    expect(state.targets).toEqual([
      { kind: 'audience', id: 'admins', label: 'Admins (role)', group: 'Audience' },
    ])
  })
})
