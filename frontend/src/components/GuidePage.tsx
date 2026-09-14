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
import { GUIDE_PAGES, getGuideMarkdown, guideImageUrls } from '../guideContent'

function docParam(): string {
  return new URLSearchParams(window.location.search).get('doc') ?? 'index'
}

function pushDocParam(slug: string) {
  const params = new URLSearchParams()
  params.set('page', 'guide')
  params.set('doc', slug)
  // Keep the app's NavHistoryState so its popstate handler still sees
  // page='guide' when the user traverses doc entries with back/forward.
  window.history.pushState(window.history.state, '', `?${params.toString()}`)
}

export interface GuideDocRequest {
  slug: string
  anchor?: string
  /** Monotonically increasing token so repeated picks of the same doc re-apply. */
  seq: number
}

interface GuidePageProps {
  /** Set when something outside the guide (e.g. search) picks a target. */
  docRequest?: GuideDocRequest
}

export default function GuidePage({ docRequest }: GuidePageProps) {
  const [doc, setDoc] = useState<string>(docParam)
  // Deferred scroll target: the anchor only exists once `doc` has rendered.
  const [pendingAnchor, setPendingAnchor] = useState<{
    slug: string
    anchor?: string
  } | null>(null)
  const [appliedSeq, setAppliedSeq] = useState(0)
  const contentRef = useRef<HTMLDivElement | null>(null)

  // Apply an external doc request (search results deep-link here) by adjusting
  // state during render. The URL is already pushed by the caller.
  if (docRequest && docRequest.seq !== appliedSeq) {
    setAppliedSeq(docRequest.seq)
    setPendingAnchor({ slug: docRequest.slug, anchor: docRequest.anchor })
    if (docRequest.slug !== doc) setDoc(docRequest.slug)
  }

  // Keep the ?doc= param truthful when the browser back/forward buttons move
  // within the guide (the app-level popstate handler restores ?page=guide).
  useEffect(() => {
    const onPop = () => {
      setPendingAnchor(null)
      setDoc(docParam())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const selectDoc = useCallback(
    (slug: string, anchor?: string) => {
      const next = slug || 'index'
      if (next === doc) {
        // Same-page anchor link — scroll now, no history entry.
        setPendingAnchor(null)
        if (anchor) document.getElementById(anchor)?.scrollIntoView()
        return
      }
      setPendingAnchor({ slug: next, anchor })
      setDoc(next)
      pushDocParam(next)
    },
    [doc],
  )

  useEffect(() => {
    // A pending target for another doc means that page hasn't rendered yet —
    // wait for the next run instead of scrolling against stale DOM.
    if (pendingAnchor && pendingAnchor.slug !== doc) return
    if (pendingAnchor?.anchor) {
      document.getElementById(pendingAnchor.anchor)?.scrollIntoView()
    } else {
      window.scrollTo({ top: 0 })
    }
  }, [doc, pendingAnchor, appliedSeq])

  const activeSlug = GUIDE_PAGES.some((p) => p.slug === doc) ? doc : 'index'
  const activeIndex = GUIDE_PAGES.findIndex((p) => p.slug === activeSlug)
  const markdown = getGuideMarkdown(activeSlug)
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

        <GuideMarkdown markdown={markdown} images={guideImageUrls} onNavigate={selectDoc} />

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
