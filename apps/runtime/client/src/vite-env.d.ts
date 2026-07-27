/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly VITE_JWT_TOKEN?: string;
  readonly VITE_SHOW_REMOTE_DEV?: string;
  readonly VITE_ENABLE_SENTRY?: string;
  readonly VITE_SPA_NAVIGATION?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_WS_URL?: string;
  /** AGPL-3.0 section 13 source offer — see AboutPage.tsx. */
  readonly VITE_EXEPAD_VERSION?: string;
  readonly VITE_EXEPAD_COMMIT?: string;
  readonly VITE_EXEPAD_SOURCE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
