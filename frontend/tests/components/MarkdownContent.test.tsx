import type { ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import MarkdownContent, {
  parseMarkdown,
  renderInline,
} from '../../src/components/MarkdownContent'

function renderWithTheme(ui: ReactElement) {
  const theme = createTheme()
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('parseMarkdown', () => {
  it('parses headings from h1 to h3', () => {
    expect(parseMarkdown('# Title\n## Section\n### Detail')).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'heading', level: 2, text: 'Section' },
      { type: 'heading', level: 3, text: 'Detail' },
    ])
  })

  it('parses paragraphs', () => {
    expect(parseMarkdown('First line\nSecond line\n\nAnother paragraph')).toEqual([
      { type: 'paragraph', text: 'First line\nSecond line' },
      { type: 'paragraph', text: 'Another paragraph' },
    ])
  })

  it('parses unordered lists with dash and star markers', () => {
    expect(parseMarkdown('- First\n* Second\n- Third')).toEqual([
      { type: 'list', items: ['First', 'Second', 'Third'] },
    ])
  })

  it('parses fenced code blocks', () => {
    expect(parseMarkdown('```\nconst x = 1;\nconsole.log(x)\n```')).toEqual([
      { type: 'code', text: 'const x = 1;\nconsole.log(x)' },
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(parseMarkdown('')).toEqual([])
  })

  it('parses mixed content in order', () => {
    expect(
      parseMarkdown(
        '# Title\n\nIntro text\n- First\n* Second\n\n```js\nconst x = 1;\n```\n\n## Next',
      ),
    ).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'Intro text' },
      { type: 'list', items: ['First', 'Second'] },
      { type: 'code', text: 'const x = 1;' },
      { type: 'heading', level: 2, text: 'Next' },
    ])
  })
})

describe('renderInline', () => {
  function InlineProbe({ text }: { text: string }) {
    return <div data-testid="inline-probe">{renderInline(text, 'test')}</div>
  }

  it('renders bold text', () => {
    renderWithTheme(<InlineProbe text="**bold**" />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('renders italic text', () => {
    renderWithTheme(<InlineProbe text="*italic*" />)
    expect(screen.getByText('italic').tagName).toBe('EM')
  })

  it('renders inline code', () => {
    renderWithTheme(<InlineProbe text="`code`" />)
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('renders plain text', () => {
    renderWithTheme(<InlineProbe text="plain text only" />)
    expect(screen.getByTestId('inline-probe')).toHaveTextContent('plain text only')
  })

  it('renders mixed inline formatting in order', () => {
    renderWithTheme(<InlineProbe text="Hello **bold** *italic* `code` world" />)

    const probe = screen.getByTestId('inline-probe')
    expect(probe).toHaveTextContent('Hello bold italic code world')
    expect(within(probe).getByText('bold').tagName).toBe('STRONG')
    expect(within(probe).getByText('italic').tagName).toBe('EM')
    expect(within(probe).getByText('code').tagName).toBe('CODE')
  })
})

describe('MarkdownContent', () => {
  it('renders headings as Typography with the expected elements and variants', () => {
    renderWithTheme(
      <MarkdownContent markdown={'# Title\n## Section\n### Detail'} />,
    )

    const h1 = screen.getByRole('heading', { level: 1, name: 'Title' })
    const h2 = screen.getByRole('heading', { level: 2, name: 'Section' })
    const h3 = screen.getByRole('heading', { level: 3, name: 'Detail' })

    expect(h1).toHaveClass('MuiTypography-subtitle1')
    expect(h2).toHaveClass('MuiTypography-subtitle2')
    expect(h3).toHaveClass('MuiTypography-body1')
  })

  it('renders lists as ul and li elements', () => {
    renderWithTheme(
      <MarkdownContent markdown={'- First item\n* Second item'} />,
    )

    const list = screen.getByRole('list')
    const items = within(list).getAllByRole('listitem')

    expect(list.tagName).toBe('UL')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('First item')
    expect(items[1]).toHaveTextContent('Second item')
  })

  it('renders fenced code blocks as pre and code', () => {
    renderWithTheme(
      <MarkdownContent markdown={'```\nconst x = 1;\n```'} />,
    )

    const code = screen.getByText('const x = 1;')
    expect(code.tagName).toBe('CODE')
    expect(code.closest('pre')).not.toBeNull()
  })

  it('applies the custom sx prop to the root container', () => {
    const { container } = renderWithTheme(
      <MarkdownContent
        markdown="Paragraph"
        sx={{ borderTop: '3px solid rgb(255, 0, 0)' }}
      />,
    )

    expect(container.firstChild).toHaveStyle({
      borderTop: '3px solid rgb(255, 0, 0)',
    })
  })
})
