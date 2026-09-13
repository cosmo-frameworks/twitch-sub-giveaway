/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Vacío en producción: el backend sirve este panel desde su mismo origen. */
  readonly VITE_BACKEND_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
