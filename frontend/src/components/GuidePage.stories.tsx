import type { Meta, StoryObj } from '@storybook/react-vite'
import GuidePage from './GuidePage'

const meta = {
  title: 'Components/GuidePage',
  component: GuidePage,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'In-app help/guide page: renders bundled guide docs (via GuideMarkdown) with a doc ' +
          'picker. Content is static; no backend required.',
      },
    },
  },
} satisfies Meta<typeof GuidePage>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
