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

/** Backwards-compatible default export (light theme). */
export const theme = buildTheme('light')
