import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ColorModeProvider from './ThemeContext'
import AuthProvider from './AuthContext'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorModeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ColorModeProvider>
  </StrictMode>,
)
