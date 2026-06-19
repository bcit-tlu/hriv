import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import CategoryRestrictionIcons from '../../src/components/CategoryRestrictionIcons'

describe('CategoryRestrictionIcons', () => {
  it('uses the muted hidden-state treatment for both program and group locks', () => {
    render(
      <CategoryRestrictionIcons
        hasProgramRestriction
        inheritedProgramRestriction={false}
        hasGroupRestriction
        inheritedGroupRestriction
        hidden
      />,
    )

    const programIcon = screen
      .getByLabelText('Restricted to specific programs')
      .querySelector('svg')
    const groupIcon = screen
      .getByLabelText('Group restriction inherited from parent')
      .querySelector('svg')

    expect(programIcon).not.toBeNull()
    expect(groupIcon).not.toBeNull()
    expect(getComputedStyle(programIcon as SVGElement).opacity).toBe('1')
    expect(getComputedStyle(groupIcon as SVGElement).opacity).toBe('0.6')
    expect(getComputedStyle(programIcon as SVGElement).color).toBe(
      getComputedStyle(groupIcon as SVGElement).color,
    )
  })
})
