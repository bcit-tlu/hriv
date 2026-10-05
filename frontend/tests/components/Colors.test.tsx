/**
 * Unit tests for the Foundations/Colors story components (`Swatch`, `Palette`).
 *
 * These are presentation-only helpers defined inside `colors.stories.tsx`, so
 * they are exercised through the composed story (Storybook portable stories).
 * The tests assert the palette structure and that colour values are read from
 * the theme in both light and dark modes.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'

import * as previewAnnotations from '../../.storybook/preview'
import * as stories from '../../src/colors.stories'

setProjectAnnotations([previewAnnotations])

const { Default } = composeStories(stories)
const DarkPalette = composeStories(stories, { initialGlobals: { theme: 'dark' } }).Default

const CHANNELS = ['primary', 'secondary', 'error', 'warning', 'info', 'success']

describe('Foundations/Colors', () => {
  it('renders every palette channel with its four variants', () => {
    render(<Default />)

    for (const channel of CHANNELS) {
      expect(screen.getByText(channel)).toBeInTheDocument()
    }
    // Each of the six channels renders main / light / dark / contrastText swatches.
    expect(screen.getAllByText('main')).toHaveLength(CHANNELS.length)
    expect(screen.getAllByText('contrastText')).toHaveLength(CHANNELS.length)
  })

  it('renders the base text / background / divider tokens', () => {
    render(<Default />)

    expect(screen.getByText('text.primary')).toBeInTheDocument()
    expect(screen.getByText('background.default')).toBeInTheDocument()
    expect(screen.getByText('divider')).toBeInTheDocument()
  })

  it('reads colour values from the theme — light and dark differ', () => {
    const light = render(<Default />).container.textContent ?? ''
    const dark = render(<DarkPalette />).container.textContent ?? ''

    // Both render the palette...
    expect(light).toContain('primary')
    expect(dark).toContain('primary')
    // ...but the rendered hex/rgb values differ between the two palettes,
    // proving swatches read live from the theme rather than hardcoded colours.
    expect(light).not.toEqual(dark)
  })
})
