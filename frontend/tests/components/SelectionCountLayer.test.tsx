/**
 * SelectionCountLayer (#1667): per-selection buttons, clear-token cancelAll,
 * auto-open once per job, Learn more -> help.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  startCount: vi.fn(),
  getCount: vi.fn(),
  cancelCount: vi.fn(),
}))

vi.mock('../../src/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/api')>()
  return {
    ...original,
    startCount: mocks.startCount,
    getCount: mocks.getCount,
    cancelCount: mocks.cancelCount,
  }
})

import SelectionCountLayer from '../../src/components/SelectionCountLayer'
import type { ApiCountJob } from '../../src/api'

function viewer() {
  const container = document.createElement('div')
  const canvas = document.createElement('div')
  container.appendChild(canvas)
  document.body.appendChild(container)
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>()
  const v = {
    container,
    canvas,
    world: {
      getItemAt: () => ({ getContentSize: () => ({ x: 5000, y: 4000 }) }),
    },
    viewport: {
      viewportToImageRectangle: (r: { x: number; y: number; width: number; height: number }) => r,
      viewportToViewerElementCoordinates: (p: { x: number; y: number }) => p,
      imageToViewerElementCoordinates: (p: { x: number; y: number }) => p,
      getFlip: () => false,
      getRotation: () => 0,
    },
    addHandler: (e: string, fn: (...a: unknown[]) => void) => {
      const l = handlers.get(e) ?? []
      l.push(fn)
      handlers.set(e, l)
    },
    removeHandler: (e: string, fn: (...a: unknown[]) => void) => {
      handlers.set(
        e,
        (handlers.get(e) ?? []).filter((f) => f !== fn),
      )
    },
  }
  return v as unknown as Parameters<typeof SelectionCountLayer>[0]['viewer']
}

const SELECTIONS = [
  { key: 1, index: 1, rect: { x: 0, y: 0, width: 0.1, height: 0.1 } },
  { key: 2, index: 2, rect: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 } },
]

function job(p: Partial<ApiCountJob>): ApiCountJob {
  return {
    job_id: 'j1',
    status: 'queued',
    queue_position: 0,
    mode: 'cells',
    selection: { x: 0, y: 0, width: 10, height: 10 },
    total: null,
    groups: null,
    objects: null,
    error: null,
    preview: null,
    ...p,
  }
}

function renderLayer(props: Partial<Parameters<typeof SelectionCountLayer>[0]> = {}) {
  const p = {
    viewer: viewer(),
    imageId: 5,
    selections: SELECTIONS,
    clearedToken: 0,
    ...props,
  }
  return render(<SelectionCountLayer {...p} />)
}

describe('SelectionCountLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a Count objects button per selection', () => {
    renderLayer()
    expect(screen.getByLabelText('Count objects in selection 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Count objects in selection 2')).toBeInTheDocument()
  })

  it('clear-token bump cancels all active jobs', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    const v = viewer()
    const { rerender } = render(
      <SelectionCountLayer viewer={v} imageId={5} selections={SELECTIONS} clearedToken={0} />,
    )
    fireEvent.click(screen.getByLabelText('Count objects in selection 1'))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Cells/ }))
    })
    await act(async () => {
      rerender(
        <SelectionCountLayer viewer={v} imageId={5} selections={SELECTIONS} clearedToken={1} />,
      )
    })
    expect(mocks.cancelCount).toHaveBeenCalledWith('j1', undefined)
  })

  it('auto-opens the report once per job — recounts reopen, re-renders do not', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    mocks.getCount.mockResolvedValue(
      job({
        status: 'done',
        total: 3,
        groups: [{ group: 0, count: 3 }],
        objects: [],
        preview: 'data:image/jpeg;base64,x',
      }),
    )
    vi.useFakeTimers()
    try {
      renderLayer({ selections: [SELECTIONS[0]] })
      fireEvent.click(screen.getByLabelText('Count objects in selection 1'))
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: /Cells/ }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      // Auto-opened once.
      expect(screen.getByText('Object count report')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Close report' }))
      await act(async () => {})
      // Poll-driven re-render must NOT reopen it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(screen.queryByText('Object count report')).not.toBeInTheDocument()

      // A recount of the same selection is a new job, so its report opens.
      mocks.startCount.mockResolvedValue({ job_id: 'j2', status: 'queued', queue_position: 0 })
      mocks.getCount.mockResolvedValue(
        job({
          job_id: 'j2',
          status: 'done',
          total: 4,
          groups: [{ group: 0, count: 4 }],
          objects: [],
          preview: 'data:image/jpeg;base64,x',
        }),
      )
      fireEvent.click(screen.getByLabelText('Count objects in selection 1 — more actions'))
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: /Count cells again/ }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(screen.getByText('Object count report')).toBeInTheDocument()
      expect(screen.getByText('4 objects found')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('Learn more opens the help dialog in place', async () => {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    mocks.getCount.mockResolvedValue(
      job({
        status: 'done',
        total: 1,
        groups: [{ group: 0, count: 1 }],
        objects: [],
        preview: 'data:image/jpeg;base64,x',
      }),
    )
    vi.useFakeTimers()
    try {
      renderLayer({ selections: [SELECTIONS[0]] })
      fireEvent.click(screen.getByLabelText('Count objects in selection 1'))
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: /Cells/ }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      fireEvent.click(screen.getByRole('button', { name: /Learn more about object counting/ }))
      expect(
        screen.getByText('Object counting', { selector: '[id="count-help-title"]' }),
      ).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('snackbar Cancel cancels only active jobs — a done result survives', async () => {
    mocks.startCount
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued', queue_position: 0 })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued', queue_position: 0 })
    mocks.getCount
      .mockResolvedValueOnce(
        job({
          job_id: 'j1',
          status: 'done',
          total: 2,
          groups: [{ group: 0, count: 2 }],
          objects: [],
          preview: 'data:image/jpeg;base64,x',
        }),
      )
      .mockResolvedValue(job({ job_id: 'j2', status: 'running' }))
    vi.useFakeTimers()
    try {
      renderLayer()
      // Job 1 -> done on sel-1.
      fireEvent.click(screen.getByLabelText('Count objects in selection 1'))
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: /Cells/ }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      screen.getByText('Object count report')
      fireEvent.click(screen.getByRole('button', { name: 'Close report' }))
      // Job 2 -> running on sel-2.
      fireEvent.click(screen.getByLabelText('Count objects in selection 2'))
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: /Cells/ }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      // Cancel the active job.
      mocks.cancelCount.mockClear()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(mocks.cancelCount).toHaveBeenCalledWith('j2', undefined)
      expect(mocks.cancelCount).not.toHaveBeenCalledWith('j1', undefined)
      // j1's result is still viewable.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'View results (2)' }))
      })
      expect(screen.getByText('Object count report')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('dialog close buttons (regression: clicks must not be swallowed)', () => {
  async function finishJob() {
    mocks.startCount.mockResolvedValue({ job_id: 'j1', status: 'queued', queue_position: 0 })
    mocks.getCount.mockResolvedValue(
      job({
        status: 'done',
        total: 2,
        groups: [{ group: 0, count: 2 }],
        objects: [],
        preview: 'data:image/jpeg;base64,x',
      }),
    )
    const v = viewer()
    render(<SelectionCountLayer viewer={v} imageId={5} selections={SELECTIONS} clearedToken={0} />)
    fireEvent.click(screen.getByLabelText('Count objects in selection 1'))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Cells/ }))
    })
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    return v
  }

  function dialogHost() {
    const dlg = document.querySelector('.MuiDialog-root')
    expect(dlg).not.toBeNull()
    return dlg!
  }

  it('report dialog mounts under data-hriv-canvas-ui; Close and X close it', async () => {
    vi.useFakeTimers()
    try {
      await finishJob()
      const dlg = dialogHost()
      expect(dlg.closest('[data-hriv-canvas-ui]')).not.toBeNull()
      // Contained Close button closes via a real click.
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(document.querySelector('.MuiDialog-root')).toBeNull()
      // Reopen via View results; the X icon closes it too.
      fireEvent.click(screen.getByRole('button', { name: /View results/ }))
      expect(document.querySelector('.MuiDialog-root')).not.toBeNull()
      fireEvent.click(screen.getByLabelText('Close report'))
      expect(document.querySelector('.MuiDialog-root')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('help dialog mounts under data-hriv-canvas-ui and its X closes it', async () => {
    vi.useFakeTimers()
    try {
      await finishJob()
      fireEvent.click(screen.getByRole('button', { name: /Learn more about object counting/ }))
      // The help dialog renders on top of the report — take the last one.
      const dlgs = document.querySelectorAll('.MuiDialog-root')
      const dlg = dlgs[dlgs.length - 1]
      expect(dlg.closest('[data-hriv-canvas-ui]')).not.toBeNull()
      fireEvent.click(screen.getByLabelText('Close help'))
      // The help Dialog unmounts after its close transition.
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(document.querySelectorAll('.MuiDialog-root').length).toBe(dlgs.length - 1)
    } finally {
      vi.useRealTimers()
    }
  })
})
