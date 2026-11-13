import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetectionReviewDialog, {
  type DetectionReviewApi,
  type DetectionViewer,
} from '../../src/components/DetectionReviewDialog'
import type { ApiImage, ApiMeasurementFinding, DetectionPreviewOut } from '../../src/api'

vi.mock('openseadragon', () => ({
  default: vi.fn(() => ({ destroy: vi.fn() })),
}))

function makeFinding(overrides: Partial<ApiMeasurementFinding> = {}): ApiMeasurementFinding {
  return {
    id: 1,
    image_id: 11,
    image_name: 'Blood film 40x',
    image_thumb: '/api/tiles/11/thumb.jpg',
    category_id: 3,
    category_path: 'Hematology › Blood films',
    image_width: 2880,
    image_height: 2048,
    status: 'pending',
    source: 'rbc',
    proposed_scale: 7.3,
    proposed_unit: 'um',
    objective: '40',
    confidence: 0.82,
    evidence: { rbc_diameter_px: 54.8, rbc_selected: 140 },
    detector_version: 'rbc-1',
    approved_scale: null,
    approved_unit: null,
    approved_objective: null,
    objective_scales: { '10': 2, '40': 7.3, '100': 18.7 },
    params: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-11-02T12:00:00Z',
    ...overrides,
  }
}

const PREVIEW: DetectionPreviewOut = {
  diameter_px: 54.8,
  component_count: 150,
  selected_count: 140,
  peak_fraction: 0.8,
  proposed_scale: 7.4,
  proposed_unit: 'um',
  objective: '40',
  confidence: 0.85,
  reason: null,
}

function makeImage(overrides: Partial<ApiImage> = {}): ApiImage {
  return {
    id: 11,
    name: 'Blood film 40x',
    thumb: '/thumb.jpg',
    tile_sources: '/api/tiles/11/image.dzi',
    category_id: 3,
    copyright: null,
    note: null,
    active: true,
    sort_order: 0,
    metadata_extra: null,
    version: 1,
    width: 2880,
    height: 2048,
    file_size: 12345,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-02T12:00:00Z',
    ...overrides,
  }
}

function makeApi(overrides: Partial<DetectionReviewApi> = {}): DetectionReviewApi {
  return {
    fetchImage: vi.fn(async () => makeImage()),
    preview: vi.fn(async () => PREVIEW),
    updateParams: vi.fn(async (id: number) => makeFinding({ id })),
    ...overrides,
  }
}

interface RenderOpts {
  api?: DetectionReviewApi
  finding?: ApiMeasurementFinding
  onOpenImage?: (imageId: number) => void
}

function renderDialog({ api = makeApi(), finding, onOpenImage }: RenderOpts = {}) {
  const onClose = vi.fn()
  const onApplied = vi.fn()
  const utils = render(
    <DetectionReviewDialog
      open
      finding={finding ?? makeFinding()}
      onClose={onClose}
      onApplied={onApplied}
      onOpenImage={onOpenImage}
      api={api}
      previewDebounceMs={10}
    />,
  )
  return { api, onClose, onApplied, ...utils }
}

describe('DetectionReviewDialog', () => {
  it('shows a preview error when the preview call fails', async () => {
    const api = makeApi({ preview: vi.fn(async () => Promise.reject(new Error('boom'))) })
    renderDialog({ api })
    const slider = await screen.findByRole('slider', { name: 'Detection sensitivity' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not preview detection.')
  })

  it('surfaces a save failure and keeps the dialog open', async () => {
    const api = makeApi({
      updateParams: vi.fn(async () => Promise.reject(new Error('conflict'))),
    })
    const { onClose, onApplied } = renderDialog({ api })
    const slider = await screen.findByRole('slider', { name: 'Detection sensitivity' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await userEvent.click(await screen.findByRole('button', { name: 'Apply tuning' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the tuning.')
    expect(onApplied).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('preserves an API-only advanced override through Apply', async () => {
    const api = makeApi()
    const finding = makeFinding({
      params: {
        sensitivity: 0.9,
        min_cell_size: 3,
        exclude_nuclei: true,
        advanced: { sat_above_background: 12 },
      },
    })
    renderDialog({ api, finding })
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Exclude purple-stained nuclei',
    })
    await userEvent.click(checkbox)
    await userEvent.click(screen.getByRole('button', { name: 'Apply tuning' }))
    await waitFor(() =>
      expect(api.updateParams).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          exclude_nuclei: false,
          advanced: { sat_above_background: 12 },
        }),
      ),
    )
  })

  it('destroys the OSD viewer when the dialog unmounts', async () => {
    const destroy = vi.fn()
    const viewerFactory = vi.fn((): DetectionViewer => ({ destroy }))
    const utils = render(
      <DetectionReviewDialog
        open
        finding={makeFinding()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
        api={makeApi()}
        previewDebounceMs={10}
        viewerFactory={viewerFactory}
      />,
    )
    await waitFor(() => expect(viewerFactory).toHaveBeenCalled())
    utils.unmount()
    expect(destroy).toHaveBeenCalled()
  })

  it('renews the image record once after a tile failure and reopens', async () => {
    const handlers: Record<string, () => void> = {}
    const viewer: DetectionViewer = {
      destroy: vi.fn(),
      // Simulate OSD firing `open` once the renewed source loads.
      open: vi.fn(() => handlers['open']?.()),
      addHandler: vi.fn((name: string, handler: () => void) => {
        handlers[name] = handler
      }),
      viewport: {
        getZoom: () => 3,
        getCenter: () => ({ x: 0.4, y: 0.6 }),
        zoomTo: vi.fn(),
        panTo: vi.fn(),
      },
    }
    const api = makeApi({
      fetchImage: vi
        .fn()
        .mockResolvedValueOnce(makeImage())
        .mockResolvedValueOnce(makeImage({ tile_sources: '/api/tiles/11/renewed.dzi' })),
    })
    render(
      <DetectionReviewDialog
        open
        finding={makeFinding()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
        api={api}
        previewDebounceMs={10}
        viewerFactory={() => viewer}
      />,
    )
    await waitFor(() => expect(handlers['tile-load-failed']).toBeTypeOf('function'))
    handlers['tile-load-failed']()
    handlers['tile-load-failed']() // bursts must not renew twice
    await waitFor(() =>
      expect(viewer.open).toHaveBeenCalledWith({ tileSource: '/api/tiles/11/renewed.dzi' }),
    )
    expect(api.fetchImage).toHaveBeenCalledTimes(2)
    expect(viewer.viewport?.zoomTo).toHaveBeenCalledWith(3, undefined, true)
    expect(viewer.viewport?.panTo).toHaveBeenCalledWith({ x: 0.4, y: 0.6 }, true)
  })

  it('"Open in viewer" navigates and closes', async () => {
    const onOpenImage = vi.fn()
    const { onClose } = renderDialog({ onOpenImage })
    await userEvent.click(await screen.findByRole('button', { name: 'Open in viewer' }))
    expect(onOpenImage).toHaveBeenCalledWith(11)
    expect(onClose).toHaveBeenCalled()
  })
})
