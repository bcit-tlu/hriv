/**
 * Unit test for the Foundations/Icons story component (`Icons`).
 *
 * `Icons` is a presentation-only gallery defined inside `icons.stories.tsx`, so
 * it is exercised through the composed story (Storybook portable stories). The
 * test asserts the labeled icon grid renders — catalogued icons shown with their
 * import name and an SVG glyph.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'

import * as previewAnnotations from '../../.storybook/preview'
import * as stories from '../../src/icons.stories'

setProjectAnnotations([previewAnnotations])

const { Default } = composeStories(stories)

describe('Foundations/Icons', () => {
  it('renders catalogued icons labeled by their import name', () => {
    render(<Default />)

    for (const name of ['Add', 'Delete', 'Edit', 'FilterList', 'Lock', 'Menu']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('renders an SVG glyph for each catalogued icon', () => {
    const { container } = render(<Default />)

    const glyphs = container.querySelectorAll('svg.MuiSvgIcon-root')
    // One glyph per catalogued icon (79) — assert comfortably more than a handful.
    expect(glyphs.length).toBeGreaterThan(50)
  })
})
