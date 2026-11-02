/**
 * CountReportDialog (#1667): group legend + total, "Group n" labels,
 * deterministic swatch colours, zero-objects alert, Learn-more help, close.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import CountReportDialog from '../../src/components/CountReportDialog'
import { countGroupColor } from '../../src/countPalette'
import type { ApiCountObject, ApiCountSelection } from '../../src/api'

const SELECTION: ApiCountSelection = { x: 100, y: 50, width: 200, height: 120 }

function roundPolygon(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

// Epic example: 72/4/1 -> three groups summing to 77.
const OBJECTS: ApiCountObject[] = [
  ...Array.from({ length: 3 }, (_, i) => ({
    group: 0,
    centroid: [120 + i * 10, 60] as [number, number],
    polygon: roundPolygon(120 + i * 10, 60, 5),
  })),
  {
    group: 1,
    centroid: [180, 90],
    polygon: roundPolygon(180, 90, 8),
  },
  {
    group: 2,
    centroid: [200, 120],
    polygon: roundPolygon(200, 120, 12),
  },
]

function renderDialog(overrides: Partial<Parameters<typeof CountReportDialog>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    label: 'Selection 2',
    mode: 'cells',
    selection: SELECTION,
    total: 77,
    groups: [
      { group: 0, count: 72 },
      { group: 1, count: 4 },
      { group: 2, count: 1 },
    ],
    objects: OBJECTS,
    preview: 'data:image/jpeg;base64,AAAA',
    onLearnMore: vi.fn(),
    ...overrides,
  }
  render(<CountReportDialog {...props} />)
  return props
}

describe('CountReportDialog', () => {
  it('renders title, subtitle, chip and the group legend with the total', () => {
    renderDialog()
    expect(screen.getByText('Object count report')).toBeInTheDocument()
    expect(screen.getByText('Selection 2 · Cells')).toBeInTheDocument()
    expect(screen.getByText('77 objects found')).toBeInTheDocument()
    expect(screen.getByText('Objects identified')).toBeInTheDocument()
    expect(screen.getByText('Group 1')).toBeInTheDocument()
    expect(screen.getByText('Group 2')).toBeInTheDocument()
    expect(screen.getByText('Group 3')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Total objects')).toBeInTheDocument()
    expect(screen.getByText('77', { selector: 'p' })).toBeInTheDocument()
  })

  it('uses the deterministic Okabe–Ito colour per group', () => {
    renderDialog()
    const swatch = screen.getByRole('img', { name: 'Group 1 colour swatch' })
    expect(swatch).toHaveStyle(`background-color: ${countGroupColor(0)}`)
  })

  it('shows an info alert instead of the legend when total is 0', () => {
    renderDialog({ total: 0, groups: [], objects: [] })
    expect(screen.getByText('No objects found in this selection.')).toBeInTheDocument()
    expect(screen.getByText('0 objects found')).toBeInTheDocument()
    expect(screen.queryByText('Total objects')).not.toBeInTheDocument()
  })

  it('Learn more opens help in place (no navigation)', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Learn more about object counting' }))
    expect(props.onLearnMore).toHaveBeenCalled()
  })

  it('close icon and Close button both dismiss', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Close report' }))
    expect(props.onClose).toHaveBeenCalled()
    renderDialog()
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('renders the singular chip for a single object', () => {
    renderDialog({ total: 1, groups: [{ group: 0, count: 1 }] })
    expect(screen.getByText('1 object found')).toBeInTheDocument()
  })
})
