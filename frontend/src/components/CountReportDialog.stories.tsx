import type { Meta, StoryObj } from '@storybook/react-vite'

import CountReportDialog from './CountReportDialog'
import type { ApiCountObject } from '../api'

function roundPolygon(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2
    const rr = r * (0.9 + 0.1 * Math.sin(a * 3))
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]
  })
}

// Deterministic pseudo-grid of objects, grouped by size tier.
const OBJECTS: ApiCountObject[] = Array.from({ length: 45 }, (_, i) => {
  const col = i % 9
  const row = Math.floor(i / 9)
  const group = i % 17 === 0 ? 2 : i % 4 === 0 ? 1 : 0
  const r = group === 0 ? 9 : group === 1 ? 14 : 19
  const cx = 40 + col * 68 + ((i * 13) % 17) - 8
  const cy = 36 + row * 58 + ((i * 7) % 13) - 6
  return {
    group,
    centroid: [cx, cy] as [number, number],
    polygon: roundPolygon(cx, cy, r),
  }
})

const GROUPS = [
  { group: 0, count: 30 },
  { group: 1, count: 12 },
  { group: 2, count: 3 },
]

// Inline SVG "specimen" — deterministic placeholder, no photo asset.
const PREVIEW =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="300" viewBox="0 0 620 300">` +
      `<rect width="620" height="300" fill="#d9b8c4"/>` +
      Array.from({ length: 45 }, (_, i) => {
        const col = i % 9
        const row = Math.floor(i / 9)
        const group = i % 17 === 0 ? 2 : i % 4 === 0 ? 1 : 0
        const r = group === 0 ? 9 : group === 1 ? 14 : 19
        const cx = 40 + col * 68 + ((i * 13) % 17) - 8
        const cy = 36 + row * 58 + ((i * 7) % 13) - 6
        return (
          `<circle cx="${cx}" cy="${cy}" r="${r * 0.85}" fill="${group === 2 ? '#7a4a8c' : group === 1 ? '#96597a' : '#5a2a55'}"/>` +
          `<circle cx="${cx}" cy="${cy}" r="${r * 0.85}" fill="none" stroke="#3d1f3a" stroke-width="1.5"/>`
        )
      }).join('') +
      `</svg>`,
  )

const meta = {
  title: 'Components/CountReportDialog',
  component: CountReportDialog,
  args: {
    open: true,
    onClose: () => {},
    label: 'Selection 2',
    mode: 'cells',
    selection: { x: 100, y: 50, width: 620, height: 300 },
    preview: PREVIEW,
    onLearnMore: () => {},
  },
  parameters: {
    chromatic: {
      modes: {
        light: { theme: 'light' },
        dark: { theme: 'dark' },
      },
    },
  },
} satisfies Meta<typeof CountReportDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    total: 45,
    groups: GROUPS,
    objects: OBJECTS,
  },
}

export const NoObjects: Story = {
  args: {
    total: 0,
    groups: [],
    objects: [],
  },
}
