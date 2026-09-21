/**
 * Shared Chromatic "modes" for colour-scheme coverage.
 *
 * A mode is a named set of Storybook globals that Chromatic replays as a
 * separate snapshot. `viewport` references a key in
 * `parameters.viewport.options` (defined in preview.tsx) and sizes the
 * snapshot; `theme` drives the addon-themes global (also wired in preview.tsx).
 *
 * DESKTOP-FIRST: this project uses the desktop view as the primary reference,
 * so every story is snapshotted at desktop width in light and dark only.
 * Mobile snapshotting was intentionally removed — to re-add it, restore a
 * `mobile` entry in `viewportOptions` below and `mobile-light` / `mobile-dark`
 * modes here.
 *
 * These modes are applied globally in preview.tsx, so EVERY story — existing
 * and new — is captured automatically; writing a new story needs no per-file
 * mode config, the component just has to render.
 */
export const responsiveModes = {
  'desktop-light': { viewport: 'desktop', theme: 'light' },
  'desktop-dark': { viewport: 'desktop', theme: 'dark' },
} as const

/**
 * Viewport definitions referenced by {@link responsiveModes}. `desktop` sits
 * comfortably above MUI's `md` (900px) breakpoint so `useMediaQuery` and
 * breakpoint `sx` resolve to their desktop branch.
 */
export const viewportOptions = {
  desktop: { name: 'Desktop', styles: { width: '1280px', height: '800px' }, type: 'desktop' },
} as const
