import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import ViewerImageDetails from './ViewerImageDetails'

const meta = {
  title: 'Components/ViewerImageDetails',
  component: ViewerImageDetails,
  args: {
    image: {
      id: 42,
      name: 'Teaching specimen',
      thumb: '',
      tileSources: '',
      active: true,
      sortOrder: 0,
      version: 1,
      copyright: 'Educational specimen',
      width: 4820,
      height: 3210,
    },
    programNames: ['Histology'],
    groupNames: [],
  },
  parameters: {
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  beforeEach: ({ parameters }) => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(url, window.location.href).pathname === '/api/images/42/source-info') {
        return Response.json(
          parameters.emptySource
            ? { original_filename: null, file_type: null, uploaded_by_name: null }
            : { original_filename: 'scan.tif', file_type: 'TIF', uploaded_by_name: 'Alex' },
        )
      }
      return original(input, init)
    }
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof ViewerImageDetails>
export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('scan.tif')).toBeVisible()
    await expect(canvas.getByText('Educational specimen')).toBeVisible()
  },
}

export const MetadataOnly: Story = {
  parameters: { emptySource: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Educational specimen')).toBeVisible()
    await expect(canvas.queryByText('Original file:')).not.toBeInTheDocument()
  },
}

export const Empty: Story = {
  parameters: { emptySource: true },
  args: {
    image: { ...meta.args.image, copyright: null, width: null, height: null },
    programNames: [],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No details available.')).toBeVisible()
  },
}
