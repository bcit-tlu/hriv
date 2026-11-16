import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import InspectorRailPrototype from './InspectorRailPrototype'
import { PROTOTYPE_BOARD } from './fixtures'

const meta = {
  title: 'Prototypes/Inspector Rail',
  component: InspectorRailPrototype,
  parameters: {
    layout: 'fullscreen',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
  },
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return new URL(url, window.location.href).pathname === '/api/boards'
        ? Response.json([PROTOTYPE_BOARD])
        : original(input, init)
    }
    return () => {
      globalThis.fetch = original
    }
  },
} satisfies Meta<typeof InspectorRailPrototype>
export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
  name: 'Closed rail / switch and close',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const details = canvas.getByRole('button', { name: 'Image details' })
    const inuksuks = canvas.getByRole('button', { name: 'Inuksuks (3)' })
    await expect(canvas.queryByTestId('inspector-panel')).not.toBeInTheDocument()
    await userEvent.click(details)
    const panel = canvas.getByTestId('inspector-panel')
    await expect(panel).toHaveAccessibleName('Details inspector')
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(inuksuks)
    await expect(canvas.getByTestId('inspector-panel')).toBe(panel)
    await expect(panel).toHaveAccessibleName('Inuksuks inspector')
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(inuksuks).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(inuksuks)
    await expect(canvas.queryByTestId('inspector-panel')).not.toBeInTheDocument()
    await expect(inuksuks).toHaveAttribute('aria-expanded', 'false')
  },
}
export const Details: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Image details' }))
    await expect(canvas.getByText('Original file:')).toBeVisible()
    await expect(canvas.getByText('renal-specimen.tif', { exact: false })).toBeVisible()
  },
}
export const Inuksuks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Renal corpuscle options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'Renal corpuscle marker' }))
    await expect(canvas.getByTestId('inspector-panel')).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'View Inuksuk: Renal corpuscle (marker hidden)' }),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: 'Inspect renal corpuscle' }),
    ).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Renal corpuscle options' }))
    await userEvent.click(canvas.getByRole('menuitemcheckbox', { name: 'Renal corpuscle marker' }))
    await expect(canvas.getByRole('button', { name: 'Inspect renal corpuscle' })).toBeVisible()
  },
}
export const Pinned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const viewport = canvas.getByRole('button', { name: 'Image viewport' })
    const width = viewport.getBoundingClientRect().width
    await userEvent.click(canvas.getByRole('button', { name: 'Image details' }))
    await expect(viewport.getBoundingClientRect().width).toBe(width)
    await userEvent.click(canvas.getByRole('button', { name: 'Pin inspector' }))
    await expect(viewport.getBoundingClientRect().width).toBeLessThan(width - 300)
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await expect(canvas.getByRole('button', { name: 'Unpin inspector' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(viewport)
    await expect(canvas.getByTestId('inspector-panel')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Unpin inspector' }))
    await expect(viewport.getBoundingClientRect().width).toBe(width)
    await userEvent.pointer({
      target: viewport,
      keys: '[MouseLeft>]',
      coords: { clientX: 30, clientY: 200 },
    })
    await expect(canvas.queryByTestId('inspector-panel')).not.toBeInTheDocument()
    await userEvent.pointer({ keys: '[/MouseLeft]' })
    await userEvent.click(canvas.getByRole('button', { name: 'Image details' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Pin inspector' }))
  },
}
export const PlacementInline: Story = {
  args: { placement: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const floating = await canvas.findByTestId('floating-placement')
    const title = await within(floating).findByRole('textbox', { name: /^Title/ })
    await userEvent.clear(title)
    await userEvent.type(title, 'Capsule comparison')
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await expect(
      within(canvas.getByTestId('inline-placement')).getByRole('textbox', { name: /^Title/ }),
    ).toHaveValue('Capsule comparison')
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await expect(
      within(canvas.getByTestId('floating-placement')).getByRole('textbox', { name: /^Title/ }),
    ).toHaveValue('Capsule comparison')
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await expect(canvas.getByRole('button', { name: 'More options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(canvas.getByRole('combobox', { name: /Board/ })).toBeVisible()
  },
}
export const PlacementFloating: Story = {
  args: { placement: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'More options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(canvas.queryByTestId('inspector-panel')).not.toBeInTheDocument()
  },
}
export const InfoCardPopover: Story = {
  args: { infoCard: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(PROTOTYPE_BOARD.name)).toBeVisible()
    await expect(canvas.getByTestId('marker-popover').getBoundingClientRect().left).toBeGreaterThan(
      canvas.getByRole('button', { name: 'Inspect renal corpuscle' }).getBoundingClientRect().right,
    )
  },
}
export const Mobile: Story = {
  parameters: {
    viewport: {
      options: {
        phone: { name: 'Phone', styles: { width: '390px', height: '844px' }, type: 'mobile' },
      },
    },
    chromatic: { viewports: [390] },
  },
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    const panel = canvas.getByTestId('inspector-panel').getBoundingClientRect()
    const viewer = canvas.getByTestId('prototype-viewer').getBoundingClientRect()
    await expect(panel.bottom).toBeCloseTo(viewer.bottom - 1, 0)
    await expect(panel.width).toBeCloseTo(viewer.width - 2, 0)
    await expect(canvas.getByRole('toolbar', { name: 'Inspector rail' })).toBeVisible()
  },
}
