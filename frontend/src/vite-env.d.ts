/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_OTEL_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
