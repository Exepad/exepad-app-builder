/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_RUNTIME_SERVICE_API_KEY?: string;
  readonly VITE_EDITOR_ORIGIN?: string;
  readonly VITE_GA_ID?: string;
  readonly VITE_ANALYTICS_ID?: string;
  readonly VITE_ENABLE_ANALYTICS?: string;
  readonly VITE_ENABLE_ERROR_TRACKING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
