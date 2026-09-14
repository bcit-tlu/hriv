import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import GuideMarkdown from './guideMarkdown'

// Markdown sources and screenshots live in frontend/guide/ so a writer can
// edit them without touching app code. Vite inlines the .md files and
// fingerprints the images at build time.
const pageSources = import.meta.glob('../../guide/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const imageFiles = import.meta.glob('../../guide/images/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>
const imageUrls: Record<string, string> = Object.fromEntries(
  Object.entries(imageFiles).map(([path, url]) => [path.split('/').pop() ?? path, url]),
)

// Ordered table of contents; the file is guide/<slug>.md.
const GUIDE_PAGES = [
  { slug: 'index', title: 'Welcome' },
  { slug: 'browsing', title: 'Browsing & Viewing' },
  { slug: 'categories', title: 'Managing Categories' },
  { slug: 'images', title: 'Managing Images' },
  { slug: 'groups', title: 'Managing Groups' },
  { slug: 'announcements', title: 'Announcements' },
  { slug: 'help', title: 'Getting Help' },
] as const

type GuideSlug = (typeof GUIDE_PAGES)[number]['slug']

function docParam(): string {
  return new URLSearchParams(window.location.search).get('doc') ?? 'index'
}

function replaceDocParam(slug: string) {
  const params = new URLSearchParams(window.location.search)
  params.set('page', 'guide')
  params.set('doc', slug)
  window.history.replaceState(window.history.state, '', `?${params.toString()}`)
}

export default function GuidePage() {
  const [doc, setDoc] = useState<string>(docParam)
  const pendingAnchorRef = useRef<string | undefined>(undefined)
  const contentRef = useRef<HTMLDivElement | null>(null)

  // Keep the ?doc= param truthful when the browser back/forward buttons move
  // within the guide (the app-level popstate handler restores ?page=guide).
  useEffect(() => {
    const onPop = () => setDoc(docParam())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const selectDoc = useCallback((slug: string, anchor?: string) => {
    pendingAnchorRef.current = anchor
    setDoc(slug || 'index')
    replaceDocParam(slug || 'index')
  }, [])

  useEffect(() => {
    const anchor = pendingAnchorRef.current
    pendingAnchorRef.current = undefined
    if (anchor) {
      document.getElementById(anchor)?.scrollIntoView()
    } else {
      window.scrollTo({ top: 0 })
    }
  }, [doc])

  const activeSlug = GUIDE_PAGES.some((p) => p.slug === doc) ? (doc as GuideSlug) : 'index'
  const activeIndex = GUIDE_PAGES.findIndex((p) => p.slug === activeSlug)
  const markdown = pageSources[`../../guide/${activeSlug}.md`] ?? ''
  const prev = activeIndex > 0 ? GUIDE_PAGES[activeIndex - 1] : undefined
  const next = activeIndex < GUIDE_PAGES.length - 1 ? GUIDE_PAGES[activeIndex + 1] : undefined

  return (
    <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
      <Paper
        variant="outlined"
        sx={{
          width: 240,
          flexShrink: 0,
          position: 'sticky',
          top: 16,
          display: { xs: 'none', md: 'block' },
        }}
      >
        <Typography
          variant="overline"
          sx={{ px: 2, pt: 1.5, display: 'block', color: 'text.secondary' }}
        >
          Guide
        </Typography>
        <List dense disablePadding sx={{ pb: 1 }}>
          {GUIDE_PAGES.map((p) => (
            <ListItemButton
              key={p.slug}
              selected={p.slug === activeSlug}
              onClick={() => selectDoc(p.slug)}
            >
              <ListItemText primary={p.title} />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      <Box ref={contentRef} sx={{ minWidth: 0, maxWidth: 880, flexGrow: 1 }}>
        {/* Compact page picker for narrow viewports. */}
        <Paper variant="outlined" sx={{ display: { xs: 'block', md: 'none' }, mb: 2 }}>
          <List dense disablePadding>
            {GUIDE_PAGES.map((p) =>
              p.slug === activeSlug ? null : (
                <ListItemButton key={p.slug} onClick={() => selectDoc(p.slug)}>
                  <ListItemText primary={p.title} />
                </ListItemButton>
              ),
            )}
          </List>
        </Paper>

        <GuideMarkdown markdown={markdown} images={imageUrls} onNavigate={selectDoc} />

        <Divider sx={{ mt: 3, mb: 2 }} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', pb: 4 }}>
          {prev ? (
            <Button startIcon={<ArrowBackIcon />} onClick={() => selectDoc(prev.slug)}>
              {prev.title}
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button endIcon={<ArrowForwardIcon />} onClick={() => selectDoc(next.slug)}>
              {next.title}
            </Button>
          ) : (
            <span />
          )}
        </Box>
      </Box>
    </Box>
  )
}
