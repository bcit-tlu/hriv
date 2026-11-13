import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { ApiImage, ApiMeasurementFinding } from '../api'
import DetectionReviewDialog, { type DetectionReviewApi } from './DetectionReviewDialog'

const FIXED_NOW = '2026-11-02T12:00:00Z'

const FINDING: ApiMeasurementFinding = {
  id: 1,
  image_id: 11,
  image_name: 'Peripheral blood film ×40',
  image_thumb: '',
  category_id: 3,
  category_path: 'Hematology › Blood films',
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
  params: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: FIXED_NOW,
}

const IMAGE: ApiImage = {
  id: 11,
  name: 'Peripheral blood film ×40',
  thumb: '',
  tile_sources: 'https://example.test/image.dzi',
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
  created_at: FIXED_NOW,
  updated_at: FIXED_NOW,
}

const PREVIEW = {
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

function makeApi(overrides: Partial<DetectionReviewApi> = {}): DetectionReviewApi {
  return {
    fetchImage: fn(async () => IMAGE),
    preview: fn(async () => PREVIEW),
    updateParams: fn(async (id: number) => ({ ...FINDING, id })),
    ...overrides,
  }
}

// A fake tile URL cannot mount real OpenSeadragon — swap in an inert viewer
// so the stories stay deterministic under Chromatic.
const viewerFactory = () => ({ destroy: () => {} })

const meta = {
  title: 'Components/DetectionReviewDialog',
  component: DetectionReviewDialog,
  args: {
    open: true,
    finding: FINDING,
    api: makeApi(),
    viewerFactory,
    previewDebounceMs: 10,
    onClose: fn(),
    onApplied: fn(),
    onOpenImage: fn(),
  },
} satisfies Meta<typeof DetectionReviewDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {}

export const Loading: Story = {
  args: { api: makeApi({ fetchImage: fn(async () => new Promise<ApiImage>(() => {})) }) },
}

export const Dirty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const slider = await canvas.findByRole('slider', { name: 'Detection sensitivity' })
    slider.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(await canvas.findByText('Unsaved')).toBeInTheDocument()
    await expect(await canvas.findByText(/7\.40 px\/µm/)).toBeInTheDocument()
  },
}

export const NoProposal: Story = {
  args: {
    api: makeApi({
      preview: fn(async () => ({
        ...PREVIEW,
        proposed_scale: null,
        objective: null,
        confidence: 0,
        reason: 'no_rbc_population',
      })),
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const slider = await canvas.findByRole('slider', { name: 'Detection sensitivity' })
    slider.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(
      await canvas.findByText(/No scale could be proposed — no rbc population/),
    ).toBeInTheDocument()
  },
}
