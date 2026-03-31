import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    primary: {
      main: '#FB5D5D',
      light: '#E1A092',
      dark: '#AB2126',
      contrastText: '#ECECEC',
    },
    secondary: {
      main: '#9F848A',
    },
    background: {
      default: '#ECECEC',
    },
    text: {
      primary: '#AB2126',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
})
