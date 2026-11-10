import type { ReactElement } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import MarkdownContent from '../../src/components/MarkdownContent'
import { parseMarkdown, renderInline, resolveMediaSrc } from '../../src/markdownUtils'

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

  it('renders plain http/https links safely', () => {
    renderWithTheme(<InlineProbe text="Visit https://example.com/docs." />)

    const link = screen.getByRole('link', { name: 'https://example.com/docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByTestId('inline-probe')).toHaveTextContent('Visit https://example.com/docs.')
  })

  it('renders markdown linked text safely', () => {
    renderWithTheme(<InlineProbe text="Read [the docs](https://example.com/docs) next." />)

    const link = screen.getByRole('link', { name: 'the docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
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
    renderWithTheme(<MarkdownContent markdown={'# Title\n## Section\n### Detail'} />)

    const h1 = screen.getByRole('heading', { level: 1, name: 'Title' })
    const h2 = screen.getByRole('heading', { level: 2, name: 'Section' })
    const h3 = screen.getByRole('heading', { level: 3, name: 'Detail' })

    expect(h1).toHaveClass('MuiTypography-subtitle1')
    expect(h2).toHaveClass('MuiTypography-subtitle2')
    expect(h3).toHaveClass('MuiTypography-body1')
  })

  it('renders lists as ul and li elements', () => {
    renderWithTheme(<MarkdownContent markdown={'- First item\n* Second item'} />)

    const list = screen.getByRole('list')
    const items = within(list).getAllByRole('listitem')

    expect(list.tagName).toBe('UL')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('First item')
    expect(items[1]).toHaveTextContent('Second item')
  })

  it('renders fenced code blocks as pre and code', () => {
    renderWithTheme(<MarkdownContent markdown={'```\nconst x = 1;\n```'} />)

    const code = screen.getByText('const x = 1;')
    expect(code.tagName).toBe('CODE')
    expect(code.closest('pre')).not.toBeNull()
  })

  it('applies the custom sx prop to the root container', () => {
    const { container } = renderWithTheme(
      <MarkdownContent markdown="Paragraph" sx={{ borderTop: '3px solid rgb(255, 0, 0)' }} />,
    )

    expect(container.firstChild).toHaveStyle({
      borderTop: '3px solid rgb(255, 0, 0)',
    })
  })
})

describe('markdown media (#1836)', () => {
  const tokens = { '12': 'tok.12', '13': 'tok-13' }

  it('parses image-only and video-only paragraphs as blocks', () => {
    expect(
      parseMarkdown('![Slide](/api/media/12)\n\n/api/media/13\n\nhttps://cdn.example/clip.mp4'),
    ).toEqual([
      { type: 'image', alt: 'Slide', src: '/api/media/12' },
      { type: 'video', src: '/api/media/13' },
      { type: 'video', src: 'https://cdn.example/clip.mp4' },
    ])
    expect(parseMarkdown('See ![x](/api/media/12) here')).toEqual([
      { type: 'paragraph', text: 'See ![x](/api/media/12) here' },
    ])
  })

  it('resolves media srcs: fresh token wins, pasted token discarded, external passes', () => {
    expect(resolveMediaSrc('/api/media/12', tokens)).toBe('/api/media/12?token=tok.12')
    expect(resolveMediaSrc('/api/media/12?token=stale', tokens)).toBe('/api/media/12?token=tok.12')
    expect(resolveMediaSrc('/api/media/99', tokens)).toBeNull()
    expect(resolveMediaSrc('/api/media/12')).toBeNull()
    expect(resolveMediaSrc('https://cdn.example/a.png', tokens)).toBe('https://cdn.example/a.png')
    expect(resolveMediaSrc('javascript:alert(1)', tokens)).toBeNull()
    expect(resolveMediaSrc('/etc/passwd', tokens)).toBeNull()
  })

  it('renders a tokenized block image as a figure with caption', () => {
    renderWithTheme(<MarkdownContent markdown="![Slide](/api/media/12)" mediaTokens={tokens} />)
    const img = screen.getByRole('img', { name: 'Slide' })
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('src', '/api/media/12?token=tok.12')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img.closest('figure')).not.toBeNull()
    expect(screen.getByText('Slide').tagName).toBe('FIGCAPTION')
  })

  it('renders inline images inside paragraphs', () => {
    renderWithTheme(
      <MarkdownContent
        markdown="Look ![tiny](https://cdn.example/t.png) now"
        mediaTokens={tokens}
      />,
    )
    const img = screen.getByRole('img', { name: 'tiny' })
    expect(img.tagName).toBe('IMG')
    expect(img.closest('p')).not.toBeNull()
  })

  it('renders a video element for standalone media paths', () => {
    const { container } = renderWithTheme(
      <MarkdownContent markdown="/api/media/13" mediaTokens={tokens} />,
    )
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('src', '/api/media/13?token=tok-13')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'metadata')
  })

  it('falls back to alt text / placeholder when the token is missing or src unsafe', () => {
    const { container } = renderWithTheme(
      <MarkdownContent
        markdown={'![Missing](/api/media/99)\n\n/api/media/98\n\n![](javascript:alert(1))'}
        mediaTokens={tokens}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText('Missing')).toHaveClass('md-media-missing')
    expect(screen.getByText('Video unavailable')).toHaveClass('md-media-missing')
    expect(screen.getByText('Image unavailable')).toBeInTheDocument()
  })
})

describe('markdown media fallbacks', () => {
  it('accepts inline image data URIs but not other data URIs', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(resolveMediaSrc(png)).toBe(png)
    expect(resolveMediaSrc('data:text/html,<script>1</script>')).toBeNull()
  })

  it('swaps a failed image for its alt-text placeholder', () => {
    const { container } = renderWithTheme(
      <MarkdownContent markdown="![Gone](https://cdn.example/missing.png)" />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Gone')).toHaveClass('md-media-missing')
  })
})
