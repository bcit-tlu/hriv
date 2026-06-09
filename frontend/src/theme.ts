import { createTheme, type ThemeOptions } from '@mui/material/styles'

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
   * Group membership chip. White on #5B6973 ≈ 5.6:1 contrast (WCAG-AA for
   * normal text). Distinct from the brand-red program chips so the two
   * visibility dimensions read differently.
   */
  groupChip: { bg: '#5B6973', text: '#FFFFFF' },
  /**
   * Visibility status colours. Active uses the brand-red primary so "visible"
   * categories/images pop; inactive uses text.primary at 0.7 alpha (#3E3C3Ab3)
   * giving ≈ 4.7 : 1 contrast on white — WCAG-AA for normal text.
   */
  visibility: { active: '#A74A4A', inactive: '#3E3C3Ab3' },
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
   * Group membership chip (dark mode). A lighter slate that stays legible on
   * the dark paper; dark text on #8A99A6 ≈ 5.5:1 contrast (WCAG-AA).
   */
  groupChip: { bg: '#8A99A6', text: '#1E1E1E' },
  /**
   * Visibility status colours (dark mode). Active uses the dark primary;
   * inactive uses text.primary at 0.6 alpha (#E0DDD999) giving ≈ 4.7 : 1
   * contrast on the dark paper — matching the light-mode ratio.
   */
  visibility: { active: '#D58881', inactive: '#E0DDD999' },
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
 * Group membership chip colours for the current mode. Background is #5B6973
 * in light mode (per design) and a WCAG-AA compliant lighter slate in dark
 * mode; `text` is the matching contrast colour.
 */
export function getGroupChipColors(mode: 'light' | 'dark'): {
  bg: string
  text: string
} {
  return mode === 'dark' ? darkPalette.groupChip : lightPalette.groupChip
}

/**
 * Visibility status colours for the current mode. `active` is the brand-red
 * primary; `inactive` is a WCAG-AA grey with built-in alpha so it can be
 * used directly as a CSS colour value.
 */
export function getVisibilityColors(mode: 'light' | 'dark'): {
  active: string
  inactive: string
} {
  return mode === 'dark' ? darkPalette.visibility : lightPalette.visibility
}
