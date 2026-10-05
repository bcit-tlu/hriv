/**
 * Unit tests for the Foundations/Spacing story components
 * (`SpacingRow`, `BreakpointRow`, `Spacing`).
 *
 * These are presentation-only helpers defined inside `spacing.stories.tsx`, so
 * they are exercised through the composed story (Storybook portable stories),
 * which applies the real theme decorator from `.storybook/preview`. The tests
 * assert the theme-derived spacing scale and responsive breakpoint values.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { composeStories, setProjectAnnotations } from '@storybook/react-vite'

import * as previewAnnotations from '../../.storybook/preview'
import * as stories from '../../src/spacing.stories'

setProjectAnnotations([previewAnnotations])

const { Default } = composeStories(stories)

describe('Foundations/Spacing', () => {
  it('renders the spacing scale with theme.spacing() px values', () => {
    render(<Default />)

    expect(screen.getByText('Spacing scale — theme.spacing(n)')).toBeInTheDocument()
    // MUI's 8px base unit: spacing(1)=8px, spacing(2)=16px, spacing(8)=64px.
    expect(screen.getByText('1 → 8px')).toBeInTheDocument()
    expect(screen.getByText('2 → 16px')).toBeInTheDocument()
    expect(screen.getByText('8 → 64px')).toBeInTheDocument()
  })

  it('renders the responsive breakpoints with their min-widths', () => {
    render(<Default />)

    expect(screen.getByText('Breakpoints — theme.breakpoints')).toBeInTheDocument()
    expect(screen.getByText('md')).toBeInTheDocument()
    expect(screen.getByText('min-width 900px')).toBeInTheDocument()
    expect(screen.getByText('min-width 1536px')).toBeInTheDocument()
  })
})
