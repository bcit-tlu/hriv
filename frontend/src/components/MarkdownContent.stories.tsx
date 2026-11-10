import type { Meta, StoryObj } from '@storybook/react-vite'
import Paper from '@mui/material/Paper'
import MarkdownContent from './MarkdownContent'

// Deterministic inline SVG so Chromatic never fetches a network image.
const slide =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200"><rect width="480" height="200" fill="%23b39ddb"/><text x="240" y="110" font-size="28" text-anchor="middle" fill="%23311b92">H&amp;E slide</text></svg>',
  )

const meta = {
  title: 'Components/MarkdownContent',
  component: MarkdownContent,
  parameters: {
    layout: 'padded',
    chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
    docs: {
      description: {
        component:
          'Renders the HRIV Markdown subset (headings, lists, code, links, emphasis) plus announcement media: `![alt](src)` images and standalone video URLs, with per-response media tokens.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Paper sx={{ p: 2, maxWidth: 560 }}>
        <Story />
      </Paper>
    ),
  ],
} satisfies Meta<typeof MarkdownContent>
export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    markdown:
      '# Lab 3 is posted\n\nBring your **own** slides. See [the guide](https://example.invalid/guide) and `scale bars`.\n\n- Section A: Tuesday\n- Section B: Thursday',
  },
}

export const WithImage: Story = {
  args: {
    markdown: `Here is the reference field:\n\n![Reference H&E field](${slide})\n\nCompare it with yours.`,
  },
}

export const InlineImage: Story = {
  args: {
    markdown: `Look for this marker ![marker](${slide}) before you count.`,
  },
}

export const TokenizedMedia: Story = {
  name: 'Tokenized media (video + image)',
  args: {
    markdown: '![Overview](/api/media/12)\n\n/api/media/13',
    mediaTokens: { '12': 'story-token-12', '13': 'story-token-13' },
  },
  parameters: {
    docs: {
      description: {
        story:
          '`/api/media/{id}` references get `?token=` appended from `mediaTokens`. In Storybook the API is absent, so the image shows its alt and the video shows an empty player.',
      },
    },
    chromatic: { disableSnapshot: true },
  },
}

export const MissingToken: Story = {
  args: {
    markdown: 'Attached: ![Missing slide](/api/media/99)\n\n/api/media/98',
    mediaTokens: {},
  },
}
