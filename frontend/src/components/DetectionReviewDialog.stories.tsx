import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import type { ApiImage, ApiMeasurementFinding } from '../api'
import DetectionReviewDialog, {
  type DetectionReviewApi,
  type DetectionReviewDialogProps,
  type DetectionViewer,
} from './DetectionReviewDialog'

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
  work_scale: null,
  outline: null,
}

// 64×46 category PNG (0 none / 1 rejected / 2 selected) drawn with pyvips —
// stands in for the detector's outline mask at story size.
const OUTLINE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAuCAAAAAC9/EAoAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAj0lEQVRIie2USQ6AMAwD2/z/0agXhJqldi2BVOErnskhJa2dHhsRcVzhqmaMwXfNGEPQpQRB2YwxqIKofICA2oIsiMsEn0zD+XQaipPTKsU+/lr6iIjvK/ozKl8Y0m1ggvw99Dk17w2QoPgDHR8aVEF4F84RQFuQBfUhBXhdUF9igF/dxiV+K9KvS/zPB7kAXUAFPOBNOAUAAAAASUVORK5CYII='

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
const viewerFactory: DetectionReviewDialogProps['viewerFactory'] = () => ({
  destroy: () => {},
})

// An outline-capable fake: `canvas` + `imageToViewerElementCoordinates`
// let DetectionOutlinesLayer paint the tinted mask over a stand-in slide.
const outlinedViewerFactory = (element: HTMLElement): DetectionViewer => {
  element.style.background = 'linear-gradient(135deg, #efe6e2 0%, #dcc9c4 55%, #cbb3ae 100%)'
  return {
    destroy: () => {},
    canvas: element,
    addHandler: () => {},
    removeHandler: () => {},
    viewport: {
      getZoom: () => 1,
      getCenter: () => ({ x: 0.5, y: 0.5 }),
      zoomTo: () => {},
      panTo: () => {},
      imageToViewerElementCoordinates: (p) => ({
        x: (p.x / 2880) * element.clientWidth,
        y: (p.y / 2048) * element.clientHeight,
      }),
    },
  }
}

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

export const WithOutlines: Story = {
  args: {
    viewerFactory: outlinedViewerFactory,
    api: makeApi({
      preview: fn(async () => ({
        ...PREVIEW,
        work_scale: 64 / 2880,
        outline: OUTLINE_PNG,
      })),
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('140 cells')).toBeInTheDocument()
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
