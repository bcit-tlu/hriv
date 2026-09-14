// Shared access to the user-guide sources. Markdown files and screenshots
// live in frontend/guide/ so a writer can edit them without touching app
// code; Vite inlines the .md files and fingerprints the images at build time.

const pageSources = import.meta.glob('../guide/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const imageFiles = import.meta.glob('../guide/images/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** Image filename (e.g. "overview.png") → fingerprinted URL. */
export const guideImageUrls: Record<string, string> = Object.fromEntries(
  Object.entries(imageFiles).map(([path, url]) => [path.split('/').pop() ?? path, url]),
)

export interface GuidePageDef {
  slug: string
  title: string
}

/** Ordered table of contents; each entry maps to guide/<slug>.md. */
export const GUIDE_PAGES: GuidePageDef[] = [
  { slug: 'index', title: 'Welcome' },
  { slug: 'browsing', title: 'Browsing & Viewing' },
  { slug: 'categories', title: 'Managing Categories' },
  { slug: 'images', title: 'Managing Images' },
  { slug: 'groups', title: 'Managing Groups' },
  { slug: 'announcements', title: 'Announcements' },
  { slug: 'help', title: 'Getting Help' },
]

/** Raw Markdown source for a page, or '' for an unknown slug. */
export function getGuideMarkdown(slug: string): string {
  return pageSources[`../guide/${slug}.md`] ?? ''
}
