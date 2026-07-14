/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // jsdom + MUI + userEvent component tests run comfortably locally but can
    // exceed 15s under full coverage on slower/shared CI runners. Give the
    // suite enough headroom to avoid timeout-only flakes without changing test
    // assertions or masking genuinely hung tests indefinitely.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/vite-env.d.ts', 'src/test/**'],
      // Floor — not target.  Ratchet upward as component-level tests
      // are filled in.  The >80 % AGENTS.md target is the goal.
      thresholds: {
        lines: 67,
        statements: 66,
        functions: 67,
        branches: 62,
      },
    },
  },
})
