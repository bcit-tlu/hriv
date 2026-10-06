/**
 * Unit test for the Foundations/Theme story components (`SurfacePanel`,
 * `KeySurfacesComparison`).
 *
 * These are presentation-only helpers defined inside `theme.stories.tsx`, so
 * they are exercised through the composed `Key Surfaces` story (Storybook
 * portable stories). The test asserts the key surfaces render in both panels.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'

import * as previewAnnotations from '../../.storybook/preview'
import * as stories from '../../src/theme.stories'

setProjectAnnotations([previewAnnotations])

const { KeySurfaces } = composeStories(stories)

describe('Foundations/Theme — Key Surfaces', () => {
  it('renders a light and a dark surface panel', () => {
    render(<KeySurfaces />)

    expect(screen.getByText('Light · background.default')).toBeInTheDocument()
    expect(screen.getByText('Dark · background.default')).toBeInTheDocument()
  })

  it('shows the key surfaces (paper, text, primary button) in each panel', () => {
    render(<KeySurfaces />)

    // One per panel (light + dark).
    expect(screen.getAllByText('Paper surface (background.paper)')).toHaveLength(2)
    expect(screen.getAllByText('Primary text (text.primary)')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Primary button' })).toHaveLength(2)
  })
})
