import type { Meta, StoryObj } from '@storybook/react-vite'
import Paper from '@mui/material/Paper'
import MarkdownContent from './MarkdownContent'

// Responsive (mobile/desktop) + light/dark snapshots are inherited from the
// global Chromatic modes in .storybook/preview.tsx.
const meta = {
  title: 'Components/MarkdownContent',
  component: MarkdownContent,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Renders the app’s restricted markdown subset (headings, paragraphs, lists, ' +
          'inline + fenced code) with theme-aware styling. Used for guide content and notes.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Paper variant="outlined" sx={{ p: 2, maxWidth: 720 }}>
        <Story />
      </Paper>
    ),
  ],
  argTypes: {
    markdown: { control: 'text', description: 'Raw markdown source.' },
  },
} satisfies Meta<typeof MarkdownContent>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  args: {
    markdown: [
      '# Uploading images',
      '',
      'Drag files onto the drop zone, or click **Browse**.',
      '',
      '- Supported: JPEG, PNG, `AVIF`',
      '- Max size: 50 MB per file',
      '',
      'Use `Ctrl+V` to paste from the clipboard.',
    ].join('\n'),
  },
}

export const WithCodeBlock: Story = {
  name: 'With Code Block',
  args: {
    markdown: [
      '## Example',
      '',
      'Run the migration:',
      '',
      '```',
      'alembic upgrade head',
      '```',
    ].join('\n'),
  },
}

export const Empty: Story = {
  args: { markdown: '' },
}
