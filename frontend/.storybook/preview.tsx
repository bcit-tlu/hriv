import type { Preview } from '@storybook/react-vite'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { withThemeFromJSXProvider } from '@storybook/addon-themes'
import { buildTheme } from '../src/theme'
import { ColorModeContext, type ColorMode } from '../src/colorModeContext'

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const mode: ColorMode = context.globals.theme === 'dark' ? 'dark' : 'light'

      return (
        <ColorModeContext.Provider
          value={{
            mode,
            preference: mode,
            setPreference: () => {},
            toggleMode: () => {},
          }}
        >
          <Story />
        </ColorModeContext.Provider>
      )
    },
    withThemeFromJSXProvider({
      themes: {
        light: buildTheme('light'),
        dark: buildTheme('dark'),
      },
      defaultTheme: 'light',
      Provider: ThemeProvider,
      GlobalStyles: CssBaseline,
    }),
  ],
  parameters: {
    a11y: {
      // Run axe after each story's play function in `test:storybook` runs.
      // 'error' fails the run on violations; use 'todo' to surface without
      // failing while the inventory is being cleaned up.
      test: 'error',
    },
    options: {
      storySort: {
        order: ['Foundations', ['Theme', 'Typography'], 'Components'],
      },
    },
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      disable: true,
    },
  },
}

export default preview
