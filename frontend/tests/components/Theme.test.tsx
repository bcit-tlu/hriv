/**
 * Unit test for the Foundations/Theme story components (`SurfacePanel`,
 * `KeySurfacesComparison`).
 *
 * These are presentation-only helpers defined inside `theme.stories.tsx`, so
 * they are exercised through the composed `Key Surfaces` story (Storybook
 * portable stories). Besides the surface structure, the tests verify theme
 * isolation: each panel renders its own mode's background, and the dark panel's
 * ScopedCssBaseline does NOT override the surrounding preview body.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'

import * as previewAnnotations from '../../.storybook/preview'
import * as stories from '../../src/theme.stories'
import { buildTheme } from '../../src/theme'

setProjectAnnotations([previewAnnotations])

const { KeySurfaces } = composeStories(stories)

// MUI/emotion emit colours as `rgb(...)`; convert the theme's hex to match.
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

const lightBg = hexToRgb(buildTheme('light').palette.background.default)
const darkBg = hexToRgb(buildTheme('dark').palette.background.default)

describe('Foundations/Theme — Key Surfaces', () => {
  it('shows the key surfaces (paper, text, primary button) in each panel', () => {
    render(<KeySurfaces />)

    expect(screen.getByText('Light · background.default')).toBeInTheDocument()
    expect(screen.getByText('Dark · background.default')).toBeInTheDocument()
    // One per panel (light + dark).
    expect(screen.getAllByText('Paper surface (background.paper)')).toHaveLength(2)
    expect(screen.getAllByText('Primary text (text.primary)')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Primary button' })).toHaveLength(2)
  })

  it('themes each panel with its own mode (light vs dark palettes)', () => {
    const { container } = render(<KeySurfaces />)

    const panelBackgrounds = Array.from(
      container.querySelectorAll('.MuiScopedCssBaseline-root'),
    ).map((el) => getComputedStyle(el).backgroundColor)

    expect(panelBackgrounds).toHaveLength(2)
    // Each panel paints its own mode's background.default — not the same palette.
    expect(panelBackgrounds).toContain(lightBg)
    expect(panelBackgrounds).toContain(darkBg)
    expect(lightBg).not.toBe(darkBg)
  })

  it('does not let the dark panel override the surrounding preview (scoped baseline)', () => {
    render(<KeySurfaces />)

    // The preview body stays the light/default theme; the dark panel's baseline
    // is scoped to its own subtree and must not leak out.
    const bodyBg = getComputedStyle(document.body).backgroundColor
    expect(bodyBg).toBe(lightBg)
    expect(bodyBg).not.toBe(darkBg)
  })
})
