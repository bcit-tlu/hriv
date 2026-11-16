import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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

async function settleDrawer(canvasElement: HTMLElement, width = 300) {
  const drawer = within(canvasElement).getByRole('complementary', { name: 'Image inspector' })
  await waitFor(() => expect(drawer.getBoundingClientRect().width).toBe(width))
  return drawer
}

export const Basic: Story = {
  name: 'Closed rail / switch and close',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const details = canvas.getByRole('button', { name: 'Image details' })
    const inuksuks = canvas.getByRole('button', { name: 'Inuksuks (3)' })
    const drawer = await settleDrawer(canvasElement, 65)
    const rail = drawer.getBoundingClientRect()
    const viewer = canvas.getByTestId('prototype-viewer').getBoundingClientRect()
    await expect(rail.width).toBe(65)
    await expect(getComputedStyle(drawer).borderLeftColor).toBe(
      getComputedStyle(canvas.getByTestId('prototype-viewer')).borderLeftColor,
    )
    await expect(rail.height).toBeCloseTo(viewer.height - 2, 0)
    await expect(rail.right).toBeCloseTo(viewer.right - 1, 0)
    await expect(canvas.getByTestId('image-viewport').getBoundingClientRect().right).toBe(rail.left)
    await expect(canvas.queryByTestId('inspector-panel')).not.toBeInTheDocument()
    const iconX = details.querySelector('svg')!.getBoundingClientRect().x
    await userEvent.click(details)
    await expect(await settleDrawer(canvasElement)).toBe(drawer)
    const panel = canvas.getByTestId('inspector-panel')
    await expect(panel).toHaveAccessibleName('Details inspector')
    await expect(drawer).toContainElement(panel)
    await expect(drawer).toContainElement(details)
    await expect(details.querySelector('svg')!.getBoundingClientRect().x).toBe(iconX)
    await expect(details.getBoundingClientRect().width).toBeGreaterThan(250)
    await expect(
      within(canvas.getByRole('navigation', { name: 'Inspector destinations' })).getByText(
        'Details',
      ),
    ).toBeVisible()
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(inuksuks)
    await expect(canvas.getByTestId('inspector-panel')).toBe(panel)
    await expect(panel).toHaveAccessibleName('Inuksuks inspector')
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(inuksuks).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(inuksuks)
    await expect(canvas.queryByTestId('inspector-panel')).not.toBeInTheDocument()
    await settleDrawer(canvasElement, 65)
    await expect(inuksuks).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(canvas.getByRole('button', { name: 'Expand inspector' }))
    await settleDrawer(canvasElement)
    await expect(canvas.getByTestId('inspector-panel')).toHaveAccessibleName('Inuksuks inspector')
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse inspector' }))
    await settleDrawer(canvasElement, 65)
    await userEvent.click(canvas.getByRole('button', { name: 'Expand inspector' }))
    await settleDrawer(canvasElement)
    await userEvent.keyboard('{Escape}')
    await settleDrawer(canvasElement, 65)
  },
}
export const Details: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Image details' }))
    await settleDrawer(canvasElement)
    await expect(canvas.getByText('Original file:')).toBeVisible()
    await expect(canvas.getByText('renal-specimen.tif', { exact: false })).toBeVisible()
  },
}
export const Inuksuks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await settleDrawer(canvasElement)
    await expect(
      getComputedStyle(canvas.getByTestId('inspector-panel').querySelector('aside')!)
        .backgroundImage,
    ).toBe('none')
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
    const longTitle = canvas.getByText('Instructor reference — adjacent tubules and capsule')
    await expect(getComputedStyle(longTitle).textOverflow).toBe('ellipsis')
    await expect(longTitle.scrollWidth).toBeGreaterThan(longTitle.clientWidth)
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Instructor reference — adjacent tubules and capsule options',
      }),
    )
    await waitFor(() =>
      expect(
        canvas.getByRole('menuitemcheckbox', {
          name: 'Instructor reference — adjacent tubules and capsule marker',
        }),
      ).toBeVisible(),
    )
    await userEvent.keyboard('{Escape}')
    await expect(canvas.getByTestId('inspector-panel')).toBeVisible()
  },
}
export const Pinned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const viewport = canvas.getByRole('button', { name: 'Image viewport' })
    const width = viewport.getBoundingClientRect().width
    await userEvent.click(canvas.getByRole('button', { name: 'Image details' }))
    await settleDrawer(canvasElement)
    await expect(viewport.getBoundingClientRect().width).toBe(width)
    await userEvent.click(canvas.getByRole('button', { name: 'Pin inspector' }))
    await waitFor(() => expect(viewport.getBoundingClientRect().width).toBe(width - (300 - 65)))
    await expect(viewport.getBoundingClientRect().right).toBe(
      canvas.getByRole('complementary', { name: 'Image inspector' }).getBoundingClientRect().left,
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await expect(canvas.getByRole('button', { name: 'Unpin inspector' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(viewport)
    await expect(canvas.getByTestId('inspector-panel')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Unpin inspector' }))
    await waitFor(() => expect(viewport.getBoundingClientRect().width).toBe(width))
    await userEvent.pointer({
      target: viewport,
      keys: '[MouseLeft>]',
      coords: { clientX: 30, clientY: 200 },
    })
    await expect(canvas.queryByTestId('inspector-panel')).not.toBeInTheDocument()
    await userEvent.pointer({ keys: '[/MouseLeft]' })
    await settleDrawer(canvasElement, 65)
    await userEvent.click(canvas.getByRole('button', { name: 'Image details' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Pin inspector' }))
    await settleDrawer(canvasElement)
    await waitFor(() => expect(viewport.getBoundingClientRect().width).toBe(width - (300 - 65)))
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
    await settleDrawer(canvasElement)
    await expect(
      within(canvas.getByTestId('inline-placement')).getByRole('textbox', { name: /^Title/ }),
    ).toHaveValue('Capsule comparison')
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await settleDrawer(canvasElement, 65)
    await expect(
      within(canvas.getByTestId('floating-placement')).getByRole('textbox', { name: /^Title/ }),
    ).toHaveValue('Capsule comparison')
    await userEvent.click(canvas.getByRole('button', { name: 'Inuksuks (3)' }))
    await settleDrawer(canvasElement)
    await expect(canvas.getByRole('button', { name: 'More options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(canvas.getByRole('combobox', { name: /Board/ })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'More options' }))
    const favourite = canvas.getByRole('checkbox', { name: 'Favourite' })
    await expect(
      favourite.parentElement!.querySelector('[data-favourite-state="off"]'),
    ).not.toBeNull()
    await userEvent.click(favourite)
    await expect(favourite).toBeChecked()
    await expect(
      favourite.parentElement!.querySelector('[data-favourite-state="on"]'),
    ).not.toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'More options' }))
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
    await expect(canvas.getByTestId('marker-popover')).toHaveTextContent('Favourite')
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
    const viewer = canvas.getByTestId('prototype-viewer').getBoundingClientRect()
    await settleDrawer(canvasElement, viewer.width - 2)
    const panel = canvas.getByTestId('inspector-panel').getBoundingClientRect()
    await expect(panel.bottom).toBeCloseTo(viewer.bottom - 1, 0)
    const rail = canvas.getByTestId('inspector-rail').getBoundingClientRect()
    await expect(rail.width).toBe(57)
    await expect(getComputedStyle(canvas.getByTestId('inspector-rail')).borderLeftColor).toBe(
      getComputedStyle(canvas.getByTestId('prototype-viewer')).borderLeftColor,
    )
    await expect(panel.width).toBeCloseTo(viewer.width - 2 - rail.width, 0)
    await expect(panel.right).toBe(rail.left)
    await expect(canvas.getByRole('navigation', { name: 'Inspector destinations' })).toBeVisible()
    const height = canvas.getByTestId('image-viewport').getBoundingClientRect().height
    await userEvent.click(canvas.getByRole('button', { name: 'Pin inspector' }))
    await expect(canvas.getByTestId('image-viewport').getBoundingClientRect().height).toBeLessThan(
      height,
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Unpin inspector' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Image viewport' }))
    await expect(canvas.queryByTestId('inspector-panel')).not.toBeInTheDocument()
    await settleDrawer(canvasElement, 57)
    await userEvent.click(canvas.getByRole('button', { name: 'Expand inspector' }))
    await settleDrawer(canvasElement, viewer.width - 2)
    await expect(canvas.getByTestId('inspector-panel')).toHaveAccessibleName('Inuksuks inspector')
  },
}
