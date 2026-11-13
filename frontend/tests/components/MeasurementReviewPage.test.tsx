import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MeasurementReviewPage, {
  type MeasurementReviewApi,
} from '../../src/components/MeasurementReviewPage'
import { evidenceSummary } from '../../src/measurementEvidence'
import type { ApiImage, ApiMeasurementFinding } from '../../src/api'

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

function makeImage(overrides: Partial<ApiImage> = {}): ApiImage {
  return {
    id: 11,
    name: 'Blood film 40x',
    thumb: '/api/tiles/11/thumb.jpg',
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

function makeApi(items: ApiMeasurementFinding[] = [makeFinding()]): MeasurementReviewApi {
  return {
    fetchFindings: vi.fn(async () => ({ items, total: items.length })),
    fetchCategories: vi.fn(async () => [
      { id: 3, path: 'Hematology › Blood films', count: items.length },
    ]),
    fetchImage: vi.fn(async (id: number) => makeImage({ id })),
    scan: vi.fn(async () => ({ image_ids: [11, 12], mode: 'queued' as const })),
    scanProgress: vi.fn(async () => ({ total: 2, done: 2 })),
    scanRemaining: vi.fn(async () => ({ remaining: 0 })),
    approve: vi.fn(async (id: number) => makeFinding({ id, status: 'approved' })),
    reject: vi.fn(async (id: number) => makeFinding({ id, status: 'rejected' })),
    reset: vi.fn(async (id: number) => makeFinding({ id, status: 'pending' })),
    bulkApprove: vi.fn(async (ids: number[]) => ({ approved: ids, skipped: [] })),
    preview: vi.fn(async () => ({
      diameter_px: 54.8,
      component_count: 150,
      selected_count: 140,
      peak_fraction: 0.8,
      proposed_scale: 7.4,
      proposed_unit: 'um',
      objective: '40',
      confidence: 0.85,
      reason: null,
      work_scale: null,
      outline: null,
    })),
    updateParams: vi.fn(async (id: number) =>
      makeFinding({
        id,
        proposed_scale: 7.4,
        confidence: 0.85,
        params: { sensitivity: 0.65, min_cell_size: 3, exclude_nuclei: true, advanced: null },
      }),
    ),
  }
}

async function openAction(name: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
  return screen.findByRole('menuitem', { name: new RegExp(`^${name}`) })
}

async function chooseAction(name: string) {
  await userEvent.click(await openAction(name))
}

describe('MeasurementReviewPage', () => {
  it('groups scans and refresh under Actions and keeps Approve selected outside', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    expect(screen.getByRole('button', { name: /Approve selected/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scan next 10' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items).toEqual([
      expect.stringMatching(/^Scan next 10/),
      expect.stringMatching(/^Scan all/),
      expect.stringMatching(/^Re-scan outdated/),
      'Refresh',
    ])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }))
    await waitFor(() => expect(api.fetchFindings).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows each finding’s category path, or Uncategorized', async () => {
    const api = makeApi([
      makeFinding(),
      makeFinding({ id: 2, image_name: 'Loose', category_id: null, category_path: null }),
    ])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Hematology › Blood films')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Uncategorized')).toBeInTheDocument()
  })

  it('filters findings by category', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    expect(api.fetchCategories).toHaveBeenCalledWith('pending')
    await userEvent.click(screen.getByRole('combobox', { name: 'Category' }))
    await userEvent.click(
      await screen.findByRole('option', { name: 'Hematology › Blood films (1)' }),
    )
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: 3, offset: 0 }),
      ),
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Category' }))
    await userEvent.click(await screen.findByRole('option', { name: 'All categories' }))
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ categoryId: expect.anything() }),
      ),
    )
  })

  it.each([
    ['Image', 'name'],
    ['Category', 'category'],
    ['Detected objective', 'objective'],
    ['Proposed', 'proposed'],
  ])('sorts by %s on the server, ascending first then descending', async (label, key) => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    const header = within(screen.getAllByRole('row')[0]).getByText(label)
    await userEvent.click(header)
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: `${key}_asc`, offset: 0 }),
      ),
    )
    await userEvent.click(header)
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: `${key}_desc` }),
      ),
    )
  })

  it('leaves Scale, Evidence and Actions unsortable', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    const head = screen.getAllByRole('row')[0]
    for (const label of ['Scale (px per unit) and unit', 'Evidence', 'Actions']) {
      expect(within(head).getByText(label).closest('.MuiTableSortLabel-root')).toBeNull()
    }
  })

  it('loads pending findings sorted by confidence (highest first)', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    expect(await screen.findByText('Blood film 40x')).toBeInTheDocument()
    expect(api.fetchFindings).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', sort: 'confidence_desc', offset: 0 }),
    )
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('×40')).toBeInTheDocument()
  })

  it('flips the confidence sort', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByText('Confidence'))
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'confidence_asc' }),
      ),
    )
  })

  it('tracks scan progress in a snackbar and reloads when the scan finishes', async () => {
    const api = makeApi()
    let finish: (value: { total: number; done: number }) => void = () => {}
    vi.mocked(api.scanProgress)
      .mockResolvedValueOnce({ total: 2, done: 1 })
      .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    render(<MeasurementReviewPage api={api} scanPollMs={10} />)
    await screen.findByText('Blood film 40x')
    await chooseAction('Scan next 10')
    expect(api.scan).toHaveBeenCalledWith({ limit: 10 })
    expect(await screen.findByText(/Scanning images: 1 of 2 done/)).toBeInTheDocument()
    await waitFor(() => expect(api.scanProgress).toHaveBeenCalledTimes(2))
    expect(await openAction('Scan next 10')).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')
    finish({ total: 2, done: 2 })
    expect(await screen.findByText('Scan finished: 2 images processed.')).toBeInTheDocument()
    expect(api.scanProgress).toHaveBeenCalledWith([11, 12])
    // Initial load, after queueing, and after the scan finished.
    await waitFor(() => expect(api.fetchFindings).toHaveBeenCalledTimes(3))
    expect(screen.queryByText(/Scanning images/)).not.toBeInTheDocument()
  })

  it('stops tracking a scan that makes no progress', async () => {
    const api = makeApi()
    vi.mocked(api.scanProgress).mockResolvedValue({ total: 2, done: 1 })
    render(<MeasurementReviewPage api={api} scanPollMs={10} scanStallMs={30} />)
    await screen.findByText('Blood film 40x')
    await chooseAction('Scan next 10')
    expect(
      await screen.findByText(/No scan progress for a while \(1 of 2 done\)/),
    ).toBeInTheDocument()
    expect(await openAction('Scan next 10')).not.toHaveAttribute('aria-disabled')
  })

  it('reports when there is nothing left to scan', async () => {
    const api = makeApi()
    vi.mocked(api.scan).mockResolvedValueOnce({ image_ids: [], mode: 'queued' })
    render(<MeasurementReviewPage api={api} scanPollMs={10} />)
    await screen.findByText('Blood film 40x')
    await chooseAction('Scan next 10')
    expect(await screen.findByText('Every image has already been scanned.')).toBeInTheDocument()
    expect(api.scanProgress).not.toHaveBeenCalled()
  })

  it('shows an error and stops tracking when progress cannot be checked', async () => {
    const api = makeApi()
    vi.mocked(api.scanProgress).mockRejectedValueOnce(new Error('boom'))
    render(<MeasurementReviewPage api={api} scanPollMs={10} />)
    await screen.findByText('Blood film 40x')
    await chooseAction('Scan next 10')
    expect(await screen.findByText(/boom|Could not check scan progress/)).toBeInTheDocument()
    expect(await openAction('Scan next 10')).not.toHaveAttribute('aria-disabled')
  })

  it('labels existing and embedded scales in the evidence column', async () => {
    const api = makeApi([
      makeFinding({
        id: 7,
        status: 'approved',
        source: 'embedded',
        confidence: 1,
        evidence: { reason: 'existing_scale' },
      }),
    ])
    render(<MeasurementReviewPage api={api} />)
    expect(await screen.findByText('embedded calibration')).toBeInTheDocument()
  })

  it('approves the proposal unchanged when the scale was not edited', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Blood film 40x' }))
    expect(api.approve).toHaveBeenCalledWith(1, {})
  })

  it('sends a corrected scale with the approval', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    const field = await screen.findByLabelText('Scale for Blood film 40x')
    await userEvent.clear(field)
    await userEvent.type(field, '2')
    await userEvent.click(screen.getByRole('button', { name: 'Approve Blood film 40x' }))
    expect(api.approve).toHaveBeenCalledWith(1, { scale: 2 })
  })

  it('sends a changed unit with the approval', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await userEvent.click(await screen.findByLabelText('Unit for Blood film 40x'))
    await userEvent.click(screen.getByRole('option', { name: 'mm' }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve Blood film 40x' }))
    expect(api.approve).toHaveBeenCalledWith(1, { unit: 'mm' })
  })

  it('fills in the calibrated scale when the objective changes', async () => {
    const api = makeApi([makeFinding({ proposed_unit: 'um' })])
    render(<MeasurementReviewPage api={api} />)
    await userEvent.click(await screen.findByLabelText('Objective for Blood film 40x'))
    await userEvent.click(screen.getByRole('option', { name: '×100' }))
    expect(screen.getByLabelText('Scale for Blood film 40x')).toHaveValue(18.7)
    await userEvent.click(screen.getByRole('button', { name: 'Approve Blood film 40x' }))
    expect(api.approve).toHaveBeenCalledWith(1, { scale: 18.7, objective: '100' })
  })

  it('keeps the scale for an uncalibrated objective on an unknown camera', async () => {
    const api = makeApi([makeFinding({ objective: null, objective_scales: null })])
    render(<MeasurementReviewPage api={api} />)
    await userEvent.click(await screen.findByLabelText('Objective for Blood film 40x'))
    await userEvent.click(screen.getByRole('option', { name: '×20' }))
    expect(screen.getByLabelText('Scale for Blood film 40x')).toHaveValue(7.3)
    await userEvent.click(screen.getByRole('button', { name: 'Approve Blood film 40x' }))
    expect(api.approve).toHaveBeenCalledWith(1, { objective: '20' })
  })

  it('approves without an objective when the reviewer clears it', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await userEvent.click(await screen.findByLabelText('Objective for Blood film 40x'))
    await userEvent.click(screen.getByRole('option', { name: 'None' }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve Blood film 40x' }))
    expect(api.approve).toHaveBeenCalledWith(1, { objective: null })
  })

  it('shows the approved objective on reviewed findings', async () => {
    const api = makeApi([
      makeFinding({ status: 'approved', approved_scale: 18.7, approved_objective: '100' }),
    ])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }))
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'approved' }),
      ),
    )
    const table = screen.getByRole('table', { name: 'Measurement findings' })
    expect(within(table).getByText('×100')).toBeInTheDocument()
  })

  it('does not show a detected objective the approval did not store', async () => {
    const api = makeApi([makeFinding({ status: 'approved', approved_scale: 7.3 })])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }))
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'approved' }),
      ),
    )
    const table = screen.getByRole('table', { name: 'Measurement findings' })
    expect(within(table).queryByText('×40')).not.toBeInTheDocument()
  })

  it('approves unit-only corrections individually during bulk approval', async () => {
    const api = makeApi([makeFinding(), makeFinding({ id: 2, image_id: 12, image_name: 'Film B' })])
    render(<MeasurementReviewPage api={api} />)
    await userEvent.click(await screen.findByLabelText('Unit for Film B'))
    await userEvent.click(screen.getByRole('option', { name: 'cm' }))
    await userEvent.click(screen.getByLabelText('Select all findings'))
    await userEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }))
    expect(api.approve).toHaveBeenCalledWith(2, { unit: 'cm' })
    expect(api.bulkApprove).toHaveBeenCalledWith([1])
  })

  it('requires a manual scale before approving a finding with no proposal', async () => {
    const api = makeApi([
      makeFinding({
        proposed_scale: null,
        objective: null,
        evidence: { reason: 'no_rbc_population' },
      }),
    ])
    render(<MeasurementReviewPage api={api} />)
    const approve = await screen.findByRole('button', { name: 'Approve Blood film 40x' })
    expect(approve).toBeDisabled()
    expect(screen.getByLabelText('Select Blood film 40x')).toBeDisabled()
    expect(screen.getByText('no rbc population')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Scale for Blood film 40x'), '18.7')
    expect(approve).toBeEnabled()
  })

  it('rejects a finding', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Reject Blood film 40x' }))
    expect(api.reject).toHaveBeenCalledWith(1)
    expect(await screen.findByText(/Rejected “/)).toBeInTheDocument()
  })

  it('bulk approves the selected findings', async () => {
    const api = makeApi([makeFinding(), makeFinding({ id: 2, image_id: 12, image_name: 'Film B' })])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Film B')
    await userEvent.click(screen.getByLabelText('Select all findings'))
    await userEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }))
    expect(api.bulkApprove).toHaveBeenCalledWith([1, 2])
    expect(await screen.findByText('Approved 2.')).toBeInTheDocument()
  })

  it('approves corrected rows individually during bulk approval', async () => {
    const api = makeApi([makeFinding(), makeFinding({ id: 2, image_id: 12, image_name: 'Film B' })])
    render(<MeasurementReviewPage api={api} />)
    const field = await screen.findByLabelText('Scale for Film B')
    await userEvent.clear(field)
    await userEvent.type(field, '2')
    await userEvent.click(screen.getByLabelText('Select all findings'))
    await userEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }))
    expect(api.approve).toHaveBeenCalledWith(2, { scale: 2 })
    expect(api.bulkApprove).toHaveBeenCalledWith([1])
    expect(await screen.findByText('Approved 2.')).toBeInTheDocument()
  })

  it('steps back a page when the current page empties', async () => {
    const api = makeApi()
    vi.mocked(api.fetchFindings).mockImplementation(async (query = {}) =>
      query.offset ? { items: [], total: 25 } : { items: [makeFinding()], total: 26 },
    )
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenCalledWith(expect.objectContaining({ offset: 25 })),
    )
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 })),
    )
    expect(await screen.findByText('Blood film 40x')).toBeInTheDocument()
  })

  it('resets an approved finding back to pending', async () => {
    const api = makeApi([makeFinding({ status: 'approved', approved_scale: 7.3 })])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Reset Blood film 40x' }))
    expect(api.reset).toHaveBeenCalledWith(1)
    expect(await screen.findByText('Reset “Blood film 40x” to pending.')).toBeInTheDocument()
  })

  it('resets a rejected finding back to pending', async () => {
    const api = makeApi([makeFinding({ status: 'rejected' })])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Rejected' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Reset Blood film 40x' }))
    expect(api.reset).toHaveBeenCalledWith(1)
  })

  it('links the thumbnail to the viewer and the name to the edit dialog', async () => {
    // Reviewed rows still navigate — only pending thumbnails open the
    // inspect-and-tune dialog (#1871).
    const api = makeApi([makeFinding({ status: 'approved', approved_scale: 7.3 })])
    const onOpenImage = vi.fn()
    const onEditImage = vi.fn()
    render(<MeasurementReviewPage api={api} onOpenImage={onOpenImage} onEditImage={onEditImage} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Blood film 40x' }))
    expect(onOpenImage).toHaveBeenCalledWith(11)
    await userEvent.click(screen.getByRole('button', { name: 'Blood film 40x' }))
    expect(onEditImage).toHaveBeenCalledWith(11)
  })

  it('opens the learn-more dialog from the description link', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Learn more' }))
    expect(await screen.findByText('How measurement review works')).toBeInTheDocument()
    expect(screen.getByText(/how many cells were measured/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  })

  it('keeps an in-progress correction across an external refresh', async () => {
    const api = makeApi()
    const { rerender } = render(<MeasurementReviewPage api={api} refreshToken={0} />)
    const field = await screen.findByLabelText('Scale for Blood film 40x')
    await userEvent.clear(field)
    await userEvent.type(field, '2')
    vi.mocked(api.fetchFindings).mockResolvedValue({
      items: [makeFinding({ confidence: 0.55 })],
      total: 1,
    })
    rerender(<MeasurementReviewPage api={api} refreshToken={1} />)
    // Wait for the refreshed row to render before checking the edit survived.
    await screen.findByText('55%')
    expect(screen.getByLabelText('Scale for Blood film 40x')).toHaveValue(2)
  })

  it('drops a correction only when its row leaves the fetched page', async () => {
    const api = makeApi()
    const { rerender } = render(<MeasurementReviewPage api={api} refreshToken={0} />)
    const field = await screen.findByLabelText('Scale for Blood film 40x')
    await userEvent.clear(field)
    await userEvent.type(field, '2')
    vi.mocked(api.fetchFindings).mockResolvedValue({ items: [], total: 0 })
    rerender(<MeasurementReviewPage api={api} refreshToken={1} />)
    await screen.findByText(/No findings to review/)
    // The row is gone; a later refetch that restores it must not resurrect the edit.
    vi.mocked(api.fetchFindings).mockResolvedValue({
      items: [makeFinding()],
      total: 1,
    })
    rerender(<MeasurementReviewPage api={api} refreshToken={2} />)
    expect(await screen.findByLabelText('Scale for Blood film 40x')).toHaveValue(7.3)
  })

  it('scans the whole library and tracks remaining candidates', async () => {
    const api = makeApi()
    vi.mocked(api.scanRemaining)
      .mockResolvedValueOnce({ remaining: 2 })
      .mockResolvedValueOnce({ remaining: 0 })
    render(<MeasurementReviewPage api={api} scanPollMs={10} />)
    await screen.findByText('Blood film 40x')
    await chooseAction('Scan all')
    expect(api.scan).toHaveBeenCalledWith({ all: true })
    expect(await screen.findByText(/Scanning images: 0 of 2 done/)).toBeInTheDocument()
    expect(await screen.findByText('Scan finished: 2 images processed.')).toBeInTheDocument()
    expect(api.scanRemaining).toHaveBeenCalledWith({ rescan: false, maxImageId: 12 })
    expect(api.scanProgress).not.toHaveBeenCalled()
  })

  it('re-scans every image with an outdated finding', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} scanPollMs={10} />)
    await screen.findByText('Blood film 40x')
    await chooseAction('Re-scan outdated')
    expect(api.scan).toHaveBeenCalledWith({ all: true, rescan: true })
    await waitFor(() =>
      expect(api.scanRemaining).toHaveBeenCalledWith({ rescan: true, maxImageId: 12 }),
    )
  })

  it('shows reviewed findings read-only', async () => {
    const api = makeApi([makeFinding({ status: 'approved', approved_scale: 2 })])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }))
    await waitFor(() =>
      expect(api.fetchFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'approved' }),
      ),
    )
    const table = screen.getByRole('table', { name: 'Measurement findings' })
    expect(within(table).getByText('2.00 px/µm')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve Blood/ })).not.toBeInTheDocument()
  })

  it('shows sub-0.01 approved scales without rounding to zero', async () => {
    const api = makeApi([
      makeFinding({ status: 'approved', approved_scale: 0.0073, approved_unit: 'nm' }),
    ])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }))
    expect(await screen.findByText('0.0073 px/nm')).toBeInTheDocument()
  })

  it('surfaces load errors', async () => {
    const api = makeApi()
    vi.mocked(api.fetchFindings).mockRejectedValueOnce(new Error('boom'))
    render(<MeasurementReviewPage api={api} />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('inspect-and-tune dialog', () => {
  async function openDialog(api = makeApi()) {
    const onOpenImage = vi.fn()
    render(<MeasurementReviewPage api={api} onOpenImage={onOpenImage} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Inspect and tune Blood film 40x' }))
    return { api, onOpenImage }
  }

  it('opens the dialog from a pending thumbnail without navigating', async () => {
    const { api, onOpenImage } = await openDialog()
    expect(
      await screen.findByRole('dialog', { name: /Inspect and tune — Blood film 40x/ }),
    ).toBeInTheDocument()
    expect(onOpenImage).not.toHaveBeenCalled()
    expect(api.fetchImage).toHaveBeenCalledWith(11)
  })

  it('previews detection when a control changes', async () => {
    const { api } = await openDialog()
    await screen.findByRole('dialog')
    const slider = screen.getByRole('slider', { name: 'Detection sensitivity' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ sensitivity: 0.65, advanced: null }),
        ['outline'],
      ),
    )
    expect(await screen.findByText(/7.40 px\/µm/)).toBeInTheDocument()
    expect(screen.getByText(/Confidence: 85%/)).toBeInTheDocument()
  })

  it('Apply persists the tuning and updates the row in place', async () => {
    const { api } = await openDialog()
    const slider = screen.getByRole('slider', { name: 'Detection sensitivity' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await waitFor(() => expect(api.preview).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Apply tuning' }))
    await waitFor(() =>
      expect(api.updateParams).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ sensitivity: 0.65 }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // The row swaps to the PATCH'd values (7.4 proposed, 85% confidence).
    const table = screen.getByRole('table', { name: 'Measurement findings' })
    expect(within(table).getByText('7.40 px/µm')).toBeInTheDocument()
    expect(within(table).getByText('85%')).toBeInTheDocument()
  })

  it('Cancel discards changes without persisting', async () => {
    const { api } = await openDialog()
    const slider = screen.getByRole('slider', { name: 'Detection sensitivity' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.updateParams).not.toHaveBeenCalled()
  })

  it('seeds saved params and Reset restores defaults', async () => {
    const api = makeApi([
      makeFinding({
        params: {
          sensitivity: 0.9,
          min_cell_size: 6,
          exclude_nuclei: false,
          advanced: null,
        },
      }),
    ])
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Inspect and tune Blood film 40x' }))
    const slider = await screen.findByRole('slider', { name: 'Detection sensitivity' })
    expect(slider).toHaveAttribute('aria-valuenow', '0.9')
    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(slider).toHaveAttribute('aria-valuenow', '0.6')
    await waitFor(() =>
      expect(api.preview).toHaveBeenLastCalledWith(
        1,
        expect.objectContaining({ sensitivity: 0.6, min_cell_size: 3, exclude_nuclei: true }),
        ['outline'],
      ),
    )
  })

  it('keeps reviewed thumbnails navigating to the viewer', async () => {
    const api = makeApi([makeFinding({ status: 'approved', approved_scale: 7.3 })])
    const onOpenImage = vi.fn()
    render(<MeasurementReviewPage api={api} onOpenImage={onOpenImage} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open Blood film 40x' }))
    expect(onOpenImage).toHaveBeenCalledWith(11)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('evidenceSummary', () => {
  it('summarizes measurements and reasons', () => {
    expect(evidenceSummary(makeFinding())).toBe('RBC ⌀ 54.8 px · 140 cells')
    expect(evidenceSummary(makeFinding({ evidence: { reason: 'source_missing' } }))).toBe(
      'source missing',
    )
    expect(evidenceSummary(makeFinding({ evidence: null }))).toBe('—')
  })
})
