import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { ApiMeasurementFinding } from '../api'
import MeasurementReviewPage, { type MeasurementReviewApi } from './MeasurementReviewPage'

const FIXED_NOW = '2026-11-02T12:00:00Z'
const THUMB =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="40"><rect width="56" height="40" fill="#e8b4c0"/><circle cx="18" cy="20" r="8" fill="#d9849a"/><circle cx="38" cy="18" r="8" fill="#d9849a"/></svg>',
  )

function makeFinding(overrides: Partial<ApiMeasurementFinding> = {}): ApiMeasurementFinding {
  return {
    id: 1,
    image_id: 11,
    image_name: 'Peripheral blood film ×40',
    image_thumb: THUMB,
    category_id: 3,
    image_width: 2880,
    image_height: 2048,
    status: 'pending',
    source: 'rbc',
    proposed_scale: 7.3,
    proposed_unit: 'um',
    objective: '40',
    confidence: 0.86,
    evidence: { rbc_diameter_px: 54.8, rbc_selected: 140 },
    detector_version: 'rbc-1',
    approved_scale: null,
    approved_unit: null,
    approved_objective: null,
    objective_scales: { '10': 2, '40': 7.3, '100': 18.7 },
    reviewed_by: null,
    reviewed_at: null,
    created_at: FIXED_NOW,
    ...overrides,
  }
}

const pendingFindings = [
  makeFinding(),
  makeFinding({
    id: 2,
    image_id: 12,
    image_name: 'Blood film ×100 oil',
    proposed_scale: 18.7,
    objective: '100',
    confidence: 0.64,
    evidence: { rbc_diameter_px: 140.3, rbc_selected: 22 },
  }),
  makeFinding({
    id: 3,
    image_id: 13,
    image_name: 'Bone marrow aspirate',
    proposed_scale: null,
    objective: null,
    confidence: 0,
    evidence: { reason: 'no_rbc_population' },
  }),
]

function makeApi(items: ApiMeasurementFinding[]): MeasurementReviewApi {
  return {
    fetchFindings: fn(async () => ({ items, total: items.length })),
    scan: fn(async () => ({ image_ids: [21, 22, 23], mode: 'queued' as const })),
    scanProgress: fn(async () => ({ total: 3, done: 3 })),
    scanRemaining: fn(async () => ({ remaining: 0 })),
    approve: fn(async (id: number) => makeFinding({ id, status: 'approved' })),
    reject: fn(async (id: number) => makeFinding({ id, status: 'rejected' })),
    reset: fn(async (id: number) => makeFinding({ id, status: 'pending' })),
    bulkApprove: fn(async (ids: number[]) => ({ approved: ids, skipped: [] })),
  }
}

const meta = {
  title: 'Components/MeasurementReviewPage',
  component: MeasurementReviewPage,
  args: { api: makeApi(pendingFindings) },
} satisfies Meta<typeof MeasurementReviewPage>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {}

export const Empty: Story = {
  args: { api: makeApi([]) },
}

export const ScanQueued: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Scan next 10' }))
    await expect(await canvas.findByText(/Scanning images: 0 of 3 done/)).toBeInTheDocument()
  },
}

export const ObjectiveSetsScale: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByLabelText('Objective for Peripheral blood film ×40'))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('option', { name: '×100' }))
    await expect(canvas.getByLabelText('Scale for Peripheral blood film ×40')).toHaveValue(18.7)
  },
}
