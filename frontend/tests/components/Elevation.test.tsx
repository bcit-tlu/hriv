/**
 * Unit test for the Foundations/Elevation story component (`Elevation`).
 *
 * `Elevation` is a presentation-only sample defined inside `elevation.stories.tsx`,
 * so it is exercised through the composed story (Storybook portable stories). The
 * test asserts a labeled Paper surface renders at each elevation level in use.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'

import * as previewAnnotations from '../../.storybook/preview'
import * as stories from '../../src/elevation.stories'

setProjectAnnotations([previewAnnotations])

const { Default } = composeStories(stories)

const LEVELS = [0, 1, 2, 3]

describe('Foundations/Elevation', () => {
  it('renders a Paper surface at each elevation level in use', () => {
    const { container } = render(<Default />)

    // One Paper per level.
    expect(container.querySelectorAll('.MuiPaper-root')).toHaveLength(LEVELS.length)

    // Each level renders MUI's corresponding elevation class.
    for (const level of LEVELS) {
      expect(container.querySelector(`.MuiPaper-elevation${level}`)).not.toBeNull()
    }
  })

  it('labels each sample with its elevation number', () => {
    render(<Default />)

    for (const level of LEVELS) {
      expect(screen.getByText(`elevation ${level}`)).toBeInTheDocument()
    }
  })
})
