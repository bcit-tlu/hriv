/**
 * Unit tests for the Foundations/Colors story components (`Swatch`, `Palette`).
 *
 * These are presentation-only helpers defined inside `colors.stories.tsx`, so
 * they are exercised through the composed story (Storybook portable stories).
 * The tests assert the palette structure and that each colour value is read from
 * the active theme in both light and dark modes (not hardcoded).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'
import type { Theme } from '@mui/material/styles'

import * as previewAnnotations from '../../.storybook/preview'
import * as stories from '../../src/colors.stories'
import { buildTheme } from '../../src/theme'

setProjectAnnotations([previewAnnotations])

const { Default } = composeStories(stories)
const DarkPalette = composeStories(stories, { initialGlobals: { theme: 'dark' } }).Default

const lightTheme = buildTheme('light')
const darkTheme = buildTheme('dark')

const CHANNELS = ['primary', 'secondary', 'error', 'warning', 'info', 'success']

// Representative tokens whose exact values are rendered as swatch captions.
const tokenValues = (theme: Theme): string[] => [
  theme.palette.primary.main,
  theme.palette.secondary.main,
  theme.palette.error.main,
  theme.palette.success.main,
  theme.palette.background.default,
]

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

  it('renders each token with its LIGHT-theme value', () => {
    const view = render(<Default />)
    for (const value of tokenValues(lightTheme)) {
      // Exact theme value must appear — a hardcoded swatch would not match.
      expect(view.getAllByText(value).length).toBeGreaterThan(0)
    }
    view.unmount()
  })

  it('renders each token with its DARK-theme value', () => {
    const view = render(<DarkPalette />)
    for (const value of tokenValues(darkTheme)) {
      expect(view.getAllByText(value).length).toBeGreaterThan(0)
    }
    view.unmount()
  })
})
