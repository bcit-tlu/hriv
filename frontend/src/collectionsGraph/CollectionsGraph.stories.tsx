import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import CollectionsGraph from './CollectionsGraph'
import { buildGraphModel } from './buildModel'
import type { ApiCollectionsGraph } from '../api'

/**
 * Deterministic literal fixture — three collections, three member images
 * (one shared by two collections, one shared by all three), two categories
 * where the second holds images in no collection (isolated node).
 */
const collections = [
  {
    id: 1,
    name: 'Skull comparison',
    type: 'sequence' as const,
    image_count: 4,
    hidden: false,
    student_curated: false,
    category_id: 10,
  },
  {
    id: 2,
    name: 'Pelvis landmarks',
    type: 'synchronized' as const,
    image_count: 3,
    hidden: false,
    student_curated: false,
    category_id: 10,
  },
  {
    id: 3,
    name: 'Teaching set',
    type: 'sequence' as const,
    image_count: 2,
    hidden: false,
    // Student-curated: the node draws the marble badge and the legend
    // lists the "Student collection" row.
    student_curated: true,
    category_id: null,
  },
]
const images = [
  { id: 10, name: 'skull_frontal.jpg', collection_ids: [1], category_id: 10 },
  { id: 11, name: 'skull_lateral.jpg', collection_ids: [1, 2], category_id: 10 },
  { id: 12, name: 'pelvis_ap.jpg', collection_ids: [1, 2, 3], category_id: 11 },
  { id: 13, name: 'pelvis_oblique.jpg', collection_ids: [3], category_id: 11 },
]
const categories = [
  { id: 10, label: 'Skull', path: 'Anatomy › Skull', image_count: 2 },
  { id: 11, label: 'Pelvis', path: 'Anatomy › Pelvis', image_count: 2 },
  { id: 12, label: 'Pathology', path: 'Anatomy › Pathology', image_count: 5 },
]

function graphPayload(order: 1 | 2 | 3): ApiCollectionsGraph {
  return {
    order,
    collections,
    images: order >= 2 ? images : [],
    categories: order >= 3 ? categories : [],
  }
}

const allIds = new Set(collections.map((c) => c.id))

const meta = {
  title: 'Components/CollectionsGraph',
  component: CollectionsGraph,
  decorators: [
    // The frame flexes to fill a column parent (#1630); give stories a
    // fixed-height column so Chromatic snapshots keep a stable size.
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: 560 }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    chromatic: { pauseAnimationAtEnd: true, diffThreshold: 0.3 },
    docs: {
      description: {
        component:
          'Canvas hub-and-spoke graph for the unified Collections page (#1629). A "Collections" hub links to every visible collection; 2nd order adds member images (shared images are accent-filled), 3rd order adds category nodes — including categories with no collection, rendered isolated. Search highlights without removing nodes; Fit re-centres on demand.',
      },
    },
  },
  args: {
    onOpenCollection: fn(),
    onOpenImage: fn(),
    // Stories stop the simulation after the synchronous pre-ticks so the
    // Chromatic baseline is deterministic.
    simulate: false,
  },
} satisfies Meta<typeof CollectionsGraph>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: { model: buildGraphModel(graphPayload(1), allIds, false) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('collections-graph-canvas')).toBeInTheDocument()
    await expect(canvas.getByTestId('graph-stats')).toHaveTextContent('3 collections')
  },
}

export const SecondOrder: Story = {
  args: { model: buildGraphModel(graphPayload(2), allIds, false) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('graph-stats')).toHaveTextContent(
      '3 collections · 4 images · 2 shared',
    )
  },
}

export const ThirdOrder: Story = {
  args: { model: buildGraphModel(graphPayload(3), allIds, false) },
  parameters: {
    docs: {
      description: {
        story:
          'Pathology has visible images but no collection — it renders as an isolated node (the "not yet transitioned to a collection" signal, #1633).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('graph-stats')).toHaveTextContent(
      '3 categories (1 without a collection)',
    )
  },
}

export const SharedOnly: Story = {
  args: { model: buildGraphModel(graphPayload(2), allIds, true) },
  parameters: {
    docs: {
      description: {
        story:
          'Shared only hides single-collection images from drawing and hit testing; they stay in the simulation.',
      },
    },
  },
}

export const Empty: Story = {
  args: { model: buildGraphModel(graphPayload(2), new Set(), false) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('collections-graph-empty')).toBeInTheDocument()
  },
}
