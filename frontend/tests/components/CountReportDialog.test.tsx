/**
 * CountReportDialog (#1667): group legend + total, "Group n" labels,
 * deterministic swatch colours, zero-objects alert, Learn-more help, close.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    expect(screen.getByText('Selection 2 · Objects')).toBeInTheDocument()
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

describe('CountReportDialog adjust mode (#1746)', () => {
  function adjustProps(overrides = {}) {
    return {
      total: 5,
      groups: [
        { group: 0, count: 3 },
        { group: 1, count: 1 },
        { group: 2, count: 1 },
      ],
      removed: [] as number[],
      added: [],
      onToggleObject: vi.fn(),
      onAddObject: vi.fn(),
      onResetAdjustments: vi.fn(),
      ...overrides,
    }
  }

  function stubSvgRect() {
    const svg = document.querySelector('svg[data-count-outlines]') as SVGSVGElement
    expect(svg).not.toBeNull()
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 120,
      width: 200,
      height: 120,
      toJSON: () => ({}),
    } as DOMRect)
    return svg
  }

  it('hides the Adjust button without adjust callbacks', () => {
    renderDialog()
    expect(screen.queryByRole('button', { name: 'Adjust count' })).not.toBeInTheDocument()
  })

  it('opens in adjust mode; Done leaves view-only and Adjust count re-enters', async () => {
    const user = userEvent.setup()
    renderDialog(adjustProps())
    expect(
      screen.getByText(/Click an outline to remove it — click again to undo/),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /outline — activate to remove/ })).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryAllByRole('button', { name: /outline — activate/ })).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Adjust count' }))
    expect(screen.getAllByRole('button', { name: /outline — activate to remove/ })).toHaveLength(5)
  })

  it('clicking an outline toggles its removed state by combined index', async () => {
    const user = userEvent.setup()
    const props = renderDialog(adjustProps())
    await user.click(screen.getAllByRole('button', { name: /outline — activate to remove/ })[1])
    expect(props.onToggleObject).toHaveBeenCalledWith(1)
  })

  it('Enter toggles an outline from the keyboard', async () => {
    const user = userEvent.setup()
    const props = renderDialog(adjustProps())
    const outline = screen.getAllByRole('button', { name: /outline — activate to remove/ })[0]
    outline.focus()
    await user.keyboard('{Enter}')
    expect(props.onToggleObject).toHaveBeenCalledWith(0)
  })

  it('removed outlines render dimmed with a restore label', () => {
    renderDialog(adjustProps({ removed: [1] }))
    const removedG = document.querySelector('g[data-count-object="1"]')
    expect(removedG).toHaveAttribute('data-removed')
    expect(removedG).toHaveAttribute('opacity', '0.3')
    expect(
      screen.getByRole('button', { name: /outline — removed; activate to restore/ }),
    ).toBeInTheDocument()
  })

  it('a click on empty space adds a median-sized outline there', () => {
    const props = renderDialog(adjustProps())
    const svg = stubSvgRect()
    // Client (150,80) maps to level-0 (150 + 100, 80 + 50) = (250, 130) —
    // the viewBox origin is the selection's (x, y).
    fireEvent.pointerDown(svg, { button: 0, clientX: 150, clientY: 80 })
    fireEvent.pointerUp(svg, { button: 0, clientX: 150, clientY: 80 })
    expect(props.onAddObject).toHaveBeenCalledTimes(1)
    const obj = props.onAddObject.mock.calls[0][0]
    // Median equivalent radius of the octagon fixtures: the three r=5
    // group-0 objects dominate -> r ≈ 4.75. 24-gon centred on the click.
    expect(obj.polygon).toHaveLength(24)
    for (const [x, y] of obj.polygon) {
      expect(Math.hypot(x - 250, y - 130)).toBeGreaterThan(4)
      expect(Math.hypot(x - 250, y - 130)).toBeLessThan(6)
    }
    // Nearest-area group: a ~4.75-radius circle is closest to group 0.
    expect(obj.group).toBe(0)
    expect(obj.centroid[0]).toBeCloseTo(250, 0)
    expect(obj.centroid[1]).toBeCloseTo(130, 0)
  })

  it('a drag adds an outline of the drawn radius', () => {
    const props = renderDialog(adjustProps())
    const svg = stubSvgRect()
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 60 })
    fireEvent.pointerMove(svg, { clientX: 115, clientY: 60 })
    fireEvent.pointerUp(svg, { button: 0, clientX: 115, clientY: 60 })
    expect(props.onAddObject).toHaveBeenCalledTimes(1)
    const obj = props.onAddObject.mock.calls[0][0]
    // Centre = level-0 (200, 110); drawn radius 15 level-0 px.
    expect(obj.centroid[0]).toBeCloseTo(200, 0)
    for (const [x, y] of obj.polygon) {
      expect(Math.hypot(x - 200, y - 110)).toBeCloseTo(15, 0)
    }
  })

  it('pressing an outline starts no draw — toggle only', () => {
    const props = renderDialog(adjustProps())
    stubSvgRect()
    const g = document.querySelector('g[data-count-object="0"]')!
    fireEvent.pointerDown(g, { button: 0, clientX: 120, clientY: 60 })
    fireEvent.pointerUp(g, { button: 0, clientX: 120, clientY: 60 })
    expect(props.onAddObject).not.toHaveBeenCalled()
  })

  it('Reset is disabled until an adjustment exists', () => {
    renderDialog(adjustProps())
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('Reset restores the original result', async () => {
    const user = userEvent.setup()
    const props = renderDialog(adjustProps({ removed: [0] }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(props.onResetAdjustments).toHaveBeenCalled()
  })
})
