import { alpha, createTheme, type ThemeOptions } from '@mui/material/styles'

// ---------------------------------------------------------------------------
// Colour palettes – edit these values to adjust light / dark appearance.
// Each palette maps the same semantic keys so the rest of the app stays
// consistent regardless of mode.
// ---------------------------------------------------------------------------

/** Light-mode colours (the original HRIV palette). */
const lightPalette = {
  primary: {
    main: '#A74A4A',
    light: '#D58881',
    dark: '#7A3535',
    contrastText: '#ECECEC',
  },
  secondary: {
    main: '#7F665D',
  },
  background: {
    default: '#ECECEC',
    paper: '#FFFFFF',
  },
  text: {
    primary: '#3E3C3A',
    secondary: '#6B6966',
  },
  /** Custom surface used for the People / Admin pages. */
  surfaceVariant: '#DAC7B5',
  /**
   * Groups use the secondary palette as their brand colour. The subtle
   * variant is a low-alpha fill with dark text so inherited/read-only states
   * stay WCAG-AA compliant without relying on whole-chip opacity.
   */
  groupChip: {
    solidBg: '#7F665D',
    solidText: '#FFFFFF',
    subtleBg: alpha('#7F665D', 0.16),
    subtleText: '#3E3C3A',
  },
  /**
   * Visibility status colours. Active uses a neutral dark-grey so the
   * default "visible" state stays unremarkable; inactive uses text.primary
   * at 0.7 alpha (#3E3C3Ab3) giving ≈ 4.7 : 1 contrast on white — WCAG-AA.
   */
  visibility: { active: 'rgba(0,0,0,0.45)', inactive: '#3E3C3Ab3', inactiveChipBg: '#6B6966' },
  /** Mobile "What's New" announcement banner colours (light mode). */
  announce: {
    bg: '#DDEEFF',
    border: '#93C0E8',
    fg: '#0D3660',
    icon: '#1A6BBF',
    btn: '#1A5CA8',
    dismiss: '#2A6ABF',
  },
}

/** Dark-mode colours – a complementary set that keeps the same brand feel. */
const darkPalette = {
  primary: {
    main: '#D58881',
    light: '#E8AFA8',
    dark: '#A74A4A',
    contrastText: '#1E1E1E',
  },
  secondary: {
    main: '#A89288',
  },
  background: {
    default: '#1E1E1E',
    paper: '#2A2A2A',
  },
  text: {
    primary: '#E0DDD9',
    secondary: '#A8A5A1',
  },
  /** Custom surface used for the People / Admin pages. */
  surfaceVariant: '#3A3230',
  /**
   * Groups use the secondary palette as their brand colour in dark mode too.
   * The subtle variant keeps light text over a low-alpha fill so it remains
   * WCAG-AA compliant on dark paper.
   */
  groupChip: {
    solidBg: '#A89288',
    solidText: '#1E1E1E',
    subtleBg: alpha('#A89288', 0.16),
    subtleText: '#E0DDD9',
  },
  /**
   * Visibility status colours (dark mode). Active uses a neutral
   * light-grey; inactive uses text.primary at 0.6 alpha (#E0DDD999)
   * giving ≈ 4.7 : 1 contrast on dark paper — matching the light ratio.
   */
  visibility: {
    active: 'rgba(255,255,255,0.70)',
    inactive: '#E0DDD999',
    inactiveChipBg: '#6B6966',
  },
  /** Mobile "What's New" announcement banner colours (dark mode). */
  announce: {
    bg: '#0C2340',
    border: '#1A4A7A',
    fg: '#C2DFF7',
    icon: '#5AABF0',
    btn: '#5AABF0',
    dismiss: '#4A90C8',
  },
}

// ---------------------------------------------------------------------------
// Theme factory
// ---------------------------------------------------------------------------

const sharedTypography: ThemeOptions['typography'] = {
  fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
}

export function buildTheme(mode: 'light' | 'dark') {
  const palette = mode === 'dark' ? darkPalette : lightPalette

  return createTheme({
    palette: {
      mode,
      primary: palette.primary,
      secondary: palette.secondary,
      background: palette.background,
      text: {
        primary: palette.text.primary,
        secondary: palette.text.secondary,
      },
    },
    typography: sharedTypography,
  })
}

/**
 * Retrieve the custom surfaceVariant colour for the current mode.
 * Use this for the People / Admin page backgrounds instead of a hard-coded hex.
 */
export function getSurfaceVariant(mode: 'light' | 'dark'): string {
  return mode === 'dark' ? darkPalette.surfaceVariant : lightPalette.surfaceVariant
}

/**
 * Group colours for the current mode. `solid*` is the primary group colour
 * treatment; `subtle*` is the lower-emphasis version for inherited/read-only
 * states that still meets WCAG-AA contrast.
 */
export function getGroupChipColors(mode: 'light' | 'dark'): {
  solidBg: string
  solidText: string
  subtleBg: string
  subtleText: string
} {
  return mode === 'dark' ? darkPalette.groupChip : lightPalette.groupChip
}

/**
 * Visibility status colours for the current mode. `active` is a neutral
 * grey so the default "visible" state stays unremarkable; `inactive` is a
 * WCAG-AA grey with built-in alpha so it can be used directly as a CSS
 * colour value.
 */
export function getVisibilityColors(mode: 'light' | 'dark'): {
  active: string
  inactive: string
  inactiveChipBg: string
} {
  return mode === 'dark' ? darkPalette.visibility : lightPalette.visibility
}

/**
 * Colours for the mobile "What's New" announcement banner. Mirrors the
 * info-style blue treatment from the mobile design, theme-aware for
 * light / dark / auto.
 */
export function getAnnounceColors(mode: 'light' | 'dark'): {
  bg: string
  border: string
  fg: string
  icon: string
  btn: string
  dismiss: string
} {
  return mode === 'dark' ? darkPalette.announce : lightPalette.announce
}

// ---------------------------------------------------------------------------
// App-bar control sizing. Compact on mobile (xs), a step up on tablet (sm),
// full size on desktop (md+). Keyed by MUI breakpoints so the toolbar icons,
// the notification bell and the avatar all scale together and stay legible at
// each screen size.
// ---------------------------------------------------------------------------

/** Sizing for app-bar icon buttons (theme toggle, search, bell, hamburger).
 *  Spread into each button's `sx`. A uniform 40px box keeps adjacent icons
 *  evenly and tightly spaced; the glyph is a touch larger on mobile. */
export const appBarIconButtonSx = {
  p: 0.5,
  minWidth: 40,
  minHeight: 40,
  '& .MuiSvgIcon-root': { fontSize: { xs: 26, sm: 24, md: 24 } },
} as const

/** Responsive avatar dimensions matching {@link appBarIconButtonSx}. */
export const appBarAvatarSx = {
  width: { xs: 30, sm: 32, md: 34 },
  height: { xs: 30, sm: 32, md: 34 },
  fontSize: { xs: 13, sm: 13, md: 14 },
} as const

/** Responsive gap between the app-bar's right-hand controls. */
export const appBarClusterGap = { xs: 0.25, sm: 0.5, md: 1 } as const
