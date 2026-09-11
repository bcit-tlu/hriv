/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string

  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  /** Runtime deployment settings served by the frontend nginx container. */
  __HRIV_RUNTIME_CONFIG__?: {
    /** Base64-encoded OTLP/HTTP collector origin, supplied by Helm when enabled. */
    otelEndpointBase64?: string
  }
}
