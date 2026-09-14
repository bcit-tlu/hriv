import { buildGuideIndex } from '../src/guideSearch'

describe('buildGuideIndex', () => {
  const index = buildGuideIndex()

  it('produces one section per heading-delimited block run', () => {
    const imageSections = index.filter((s) => s.slug === 'images')
    const anchors = imageSections.map((s) => s.anchor)
    expect(anchors).toContain('measuring-on-an-image')
    expect(anchors).toContain('hide-an-image')
  })

  it('anchors the first section of each page to the page top', () => {
    for (const slug of [
      'index',
      'browsing',
      'categories',
      'images',
      'groups',
      'announcements',
      'help',
    ]) {
      const first = index.find((s) => s.slug === slug)
      expect(first?.anchor).toBeUndefined()
      expect(first?.heading).toBeUndefined()
    }
  })

  it('seeds heading text into the section content so heading queries match', () => {
    const section = index.find((s) => s.slug === 'images' && s.anchor === 'measuring-on-an-image')
    expect(section?.heading).toBe('Measuring on an image')
    expect(section?.content).toContain('Measuring on an image')
  })

  it('flattens Markdown syntax out of searchable text', () => {
    const joined = index.map((s) => s.content).join(' ')
    expect(joined).not.toMatch(/\]\(/)
    expect(joined).not.toMatch(/\*\*/)
    expect(joined).not.toMatch(/^!\[/m)
  })

  it('captures section body text', () => {
    const browsingTop = index.find((s) => s.slug === 'browsing' && s.anchor === undefined)
    expect(browsingTop?.content).toContain('image library')
    // A page with no intro text still gets a findable page-top section.
    const helpTop = index.find((s) => s.slug === 'help' && s.anchor === undefined)
    expect(helpTop?.title).toBe('Getting Help')
  })
})
