import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import Paper from '@mui/material/Paper'
import GuideMarkdown from './guideMarkdown'

const meta = {
  title: 'Components/GuideMarkdown',
  component: GuideMarkdown,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Markdown renderer for in-app guide pages. Resolves image filenames to served URLs ' +
          'and routes internal doc/anchor links through onNavigate.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Paper variant="outlined" sx={{ p: 2, maxWidth: 760 }}>
        <Story />
      </Paper>
    ),
  ],
  args: { images: {}, onNavigate: fn() },
} satisfies Meta<typeof GuideMarkdown>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    markdown: [
      '# Getting started',
      '',
      'Welcome to the HRIV image repository. This guide covers the basics of browsing and',
      'managing images.',
      '',
      '## Browsing',
      '',
      '- Use the category tree on the left to narrow results',
      '- Click any tile to open the full-resolution viewer',
      '',
      'See the [managing images](managing) page for edit workflows.',
    ].join('\n'),
  },
}

export const ShortNote: Story = {
  name: 'Short Note',
  args: {
    markdown: 'Tip: press **Esc** to close the viewer and return to the grid.',
  },
}
