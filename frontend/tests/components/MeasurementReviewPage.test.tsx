import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MeasurementReviewPage, {
  type MeasurementReviewApi,
} from '../../src/components/MeasurementReviewPage'
import { evidenceSummary } from '../../src/measurementEvidence'
import type { ApiMeasurementFinding } from '../../src/api'

function makeFinding(overrides: Partial<ApiMeasurementFinding> = {}): ApiMeasurementFinding {
  return {
    id: 1,
    image_id: 11,
    image_name: 'Blood film 40x',
    image_thumb: '/api/tiles/11/thumb.jpg',
    category_id: 3,
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
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-11-02T12:00:00Z',
    ...overrides,
  }
}

function makeApi(items: ApiMeasurementFinding[] = [makeFinding()]): MeasurementReviewApi {
  return {
    fetchFindings: vi.fn(async () => ({ items, total: items.length })),
    scan: vi.fn(async () => ({ image_ids: [11, 12], mode: 'queued' as const })),
    approve: vi.fn(async (id: number) => makeFinding({ id, status: 'approved' })),
    reject: vi.fn(async (id: number) => makeFinding({ id, status: 'rejected' })),
    bulkApprove: vi.fn(async (ids: number[]) => ({ approved: ids, skipped: [] })),
  }
}

describe('MeasurementReviewPage', () => {
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

  it('scans the next 10 images and reports how many were queued', async () => {
    const api = makeApi()
    render(<MeasurementReviewPage api={api} />)
    await screen.findByText('Blood film 40x')
    await userEvent.click(screen.getByRole('button', { name: 'Scan next 10' }))
    expect(api.scan).toHaveBeenCalledWith({ limit: 10 })
    expect(await screen.findByText(/Scanning 2 images/)).toBeInTheDocument()
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
    expect(within(table).getByText('2.00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve Blood/ })).not.toBeInTheDocument()
  })

  it('surfaces load errors', async () => {
    const api = makeApi()
    vi.mocked(api.fetchFindings).mockRejectedValueOnce(new Error('boom'))
    render(<MeasurementReviewPage api={api} />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
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
