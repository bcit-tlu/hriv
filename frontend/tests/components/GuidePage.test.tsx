import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import GuidePage from '../../src/components/GuidePage'
import GuideMarkdown from '../../src/components/guideMarkdown'
import { headingSlug, parseGuideMarkdown } from '../../src/guideMarkdown'
import { emitEvent } from '../../src/observability'

vi.mock('../../src/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/observability')>()),
  emitEvent: vi.fn(),
}))

function renderWithTheme(ui: ReactElement) {
  const theme = createTheme()
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('parseGuideMarkdown', () => {
  it('parses headings, paragraphs, and lists', () => {
    expect(parseGuideMarkdown('# Title\nSome text\n\n- One\n- Two')).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'Some text' },
      {
        type: 'list',
        ordered: false,
        items: [
          { text: 'One', subItems: [] },
          { text: 'Two', subItems: [] },
        ],
      },
    ])
  })

  it('parses ordered lists, nested bullets, and indented continuations', () => {
    expect(
      parseGuideMarkdown('1. First\n   continued text\n   - sub a\n   - sub b\n2. Second'),
    ).toEqual([
      {
        type: 'list',
        ordered: true,
        items: [
          { text: 'First continued text', subItems: ['sub a', 'sub b'] },
          { text: 'Second', subItems: [] },
        ],
      },
    ])
  })

  it('parses block images', () => {
    expect(parseGuideMarkdown('![Alt](images/pic.png)')).toEqual([
      { type: 'image', alt: 'Alt', src: 'images/pic.png' },
    ])
  })

  it('parses GFM tables', () => {
    expect(parseGuideMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')).toEqual([
      {
        type: 'table',
        header: ['A', 'B'],
        rows: [
          ['1', '2'],
          ['3', '4'],
        ],
      },
    ])
  })

  it('parses ::: containers with a title', () => {
    expect(parseGuideMarkdown('::: tip Good idea\nBody text\n:::')).toEqual([
      { type: 'container', kind: 'tip', title: 'Good idea', markdown: 'Body text' },
    ])
  })

  it('turns headings into kebab-case anchors', () => {
    expect(headingSlug('Measuring on an image')).toBe('measuring-on-an-image')
  })
})

describe('GuideMarkdown', () => {
  const noop = () => {}

  it('renders headings and images with resolved URLs', () => {
    renderWithTheme(
      <GuideMarkdown
        markdown={'## Section\n![Pic](images/pic.png)'}
        images={{ 'pic.png': '/assets/pic.png' }}
        onNavigate={noop}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Section' })).toHaveAttribute('id', 'section')
    expect(screen.getByRole('img', { name: 'Pic' })).toHaveAttribute('src', '/assets/pic.png')
  })

  it('routes internal links through onNavigate and external links to a new tab', async () => {
    const onNavigate = vi.fn()
    renderWithTheme(
      <GuideMarkdown
        markdown={'[Go](#anchor) [Other](images#deep) [Web](https://example.com)'}
        images={{}}
        onNavigate={onNavigate}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onNavigate).toHaveBeenCalledWith('', 'anchor')
    await userEvent.click(screen.getByRole('button', { name: 'Other' }))
    expect(onNavigate).toHaveBeenCalledWith('images', 'deep')
    expect(screen.getByRole('link', { name: 'Web' })).toHaveAttribute('href', 'https://example.com')
  })

  it('renders tip containers and tables', () => {
    renderWithTheme(
      <GuideMarkdown
        markdown={'::: tip Look\nAdvice\n:::\n\n| A |\n|---|\n| 1 |'}
        images={{}}
        onNavigate={noop}
      />,
    )
    expect(screen.getByText('Look')).toBeInTheDocument()
    expect(screen.getByText('Advice')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

describe('GuidePage', () => {
  const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView

  beforeEach(() => {
    window.history.replaceState(null, '', '?page=guide')
    window.scrollTo = vi.fn()
    vi.mocked(emitEvent).mockClear()
  })

  afterEach(() => {
    if (originalScrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    } else {
      delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('renders the welcome page with nav', () => {
    renderWithTheme(<GuidePage />)
    expect(screen.getByRole('heading', { name: 'Welcome to the HRIV Guide' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Managing Images' }).length).toBeGreaterThan(0)
  })

  it('switches pages via the nav and updates ?doc=', async () => {
    renderWithTheme(<GuidePage />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Managing Images' })[0])
    expect(screen.getByRole('heading', { name: 'Managing Images' })).toBeInTheDocument()
    expect(window.location.search).toContain('doc=images')
    expect(window.location.search).toContain('page=guide')
  })

  it('respects ?doc= on load and renders prev/next navigation', () => {
    window.history.replaceState(null, '', '?page=guide&doc=images')
    renderWithTheme(<GuidePage />)
    expect(screen.getByRole('heading', { name: 'Managing Images' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Managing Categories' })).not.toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'Managing Groups' })).not.toHaveLength(0)
  })

  it('applies docRequest to switch pages without URL state', () => {
    renderWithTheme(<GuidePage docRequest={{ slug: 'help', seq: 1 }} />)
    expect(screen.getByRole('heading', { name: 'Getting Help' })).toBeInTheDocument()
  })

  it('scrolls to the requested anchor on a new request', async () => {
    const scrollIntoView = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView
    renderWithTheme(
      <GuidePage docRequest={{ slug: 'images', anchor: 'measuring-on-an-image', seq: 2 }} />,
    )
    await screen.findByRole('heading', { name: 'Managing Images' })
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('ignores a docRequest with an already-applied seq', async () => {
    const { rerender } = renderWithTheme(<GuidePage docRequest={{ slug: 'help', seq: 5 }} />)
    expect(screen.getByRole('heading', { name: 'Getting Help' })).toBeInTheDocument()
    rerender(
      <ThemeProvider theme={createTheme()}>
        <GuidePage docRequest={{ slug: 'images', seq: 5 }} />
      </ThemeProvider>,
    )
    expect(screen.getByRole('heading', { name: 'Getting Help' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Managing Images' })).not.toBeInTheDocument()
  })

  it('emits a page-hit telemetry event per shown doc', async () => {
    window.history.replaceState(null, '', '?page=guide&doc=images')
    renderWithTheme(<GuidePage />)
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'navigation.page_changed',
        action: 'navigate_guide_doc',
        page: 'guide',
        guide_doc: 'images',
      }),
    )

    await userEvent.click(screen.getAllByRole('button', { name: 'Managing Groups' })[0])
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'navigate_guide_doc', guide_doc: 'groups' }),
    )
  })
})
