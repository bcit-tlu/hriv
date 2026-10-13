import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import CollectionGraphDialog from './CollectionGraphDialog'
import type { ApiCollectionGraph } from '../api'

/**
 * Deterministic fixture — the hub "Skull comparison" with three member
 * images; at 2nd order "Pelvis landmarks" and "Teaching set" join as
 * related collections (image 11 and 12 are shared).
 */
function collNode(id: number, name: string, type: 'sequence' | 'synchronized', count: number) {
  return { id, name, type, image_count: count, hidden: false, category_id: null }
}

function payloadFor(order: 1 | 2 | 3): ApiCollectionGraph {
  return {
    order,
    collection: collNode(1, 'Skull comparison', 'sequence', 3),
    images: [
      { id: 10, name: 'Skull comparison frontal', collection_ids: [1], category_id: 10 },
      { id: 11, name: 'Skull comparison lateral', collection_ids: [1, 2], category_id: 10 },
      { id: 12, name: 'Skull comparison oblique', collection_ids: [1, 2, 3], category_id: 11 },
    ],
    related_collections:
      order >= 2
        ? [
            collNode(2, 'Pelvis landmarks', 'synchronized', 3),
            collNode(3, 'Teaching set', 'sequence', 2),
          ]
        : [],
    categories:
      order >= 3
        ? [
            { id: 10, label: 'Skull', path: 'Anatomy › Skull', image_count: 2 },
            { id: 11, label: 'Pelvis', path: 'Anatomy › Pelvis', image_count: 2 },
          ]
        : [],
  }
}

const meta = {
  title: 'Components/CollectionGraphDialog',
  component: CollectionGraphDialog,
  parameters: {
    chromatic: { pauseAnimationAtEnd: true, diffThreshold: 0.3 },
    docs: {
      description: {
        component:
          'Read-only hub-and-spoke graph of a single collection (#1630): the collection is the hub, member images are the spokes; 2nd order adds related collections (click to move the perspective), 3rd order adds member categories. A breadcrumb walks back through the perspective stack.',
      },
    },
  },
  args: {
    open: true,
    collectionId: 1,
    collectionName: 'Skull comparison',
    categoryPaths: new Map(),
    onClose: fn(),
    onOpenImage: fn(),
    onOpenCollection: fn(),
    // Deterministic snapshots: fixture fetch + stopped simulation.
    fetchGraph: (_id: number, order?: 1 | 2 | 3) => Promise.resolve(payloadFor(order ?? 1)),
    simulate: false,
  },
} satisfies Meta<typeof CollectionGraphDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(canvas.getByText('Skull comparison — graph')).toBeInTheDocument()
    await expect(await canvas.findByTestId('collections-graph-canvas')).toBeInTheDocument()
    await expect(canvas.getByTestId('graph-stats')).toHaveTextContent('3 images')
  },
}

export const SecondOrder: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '2nd order surfaces the other collections sharing member images; clicking one pushes it onto the perspective breadcrumb.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: '2nd order' }))
    await expect(await canvas.findByTestId('graph-stats')).toHaveTextContent(
      '2 shared · 2 related collections',
    )
  },
}

export const Loading: Story = {
  args: {
    fetchGraph: () => new Promise<ApiCollectionGraph>(() => undefined),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(
      await canvas.findByRole('progressbar', { name: 'Loading collection graph' }),
    ).toBeInTheDocument()
  },
}

export const Error: Story = {
  args: {
    // `Error` here is the story export — globalThis reaches the real one.
    fetchGraph: () => Promise.reject<ApiCollectionGraph>(new globalThis.Error('boom')),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(
      await canvas.findByText('Failed to load the collection graph.'),
    ).toBeInTheDocument()
  },
}
