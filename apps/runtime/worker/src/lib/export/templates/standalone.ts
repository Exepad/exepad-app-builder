/**
 * File templates for the deterministic standalone project (D2). Most files are
 * GENERIC (data-driven from app_config.json at runtime); only the component
 * manifest, package.json, and index.html vary per app. The host shim implements
 * the two SDK globals (window.ExepadState / window.ExepadPlatform) so the
 * verbatim components run unchanged; the assembler reads app_config.json and
 * renders pages/header/footer.
 */

export interface StandaloneInputs {
  appName: string;
  slug: string;
  /** Entry component name → import path (relative to src/, no extension). */
  components: { name: string; importPath: string }[];
  /** Google Fonts (or other) stylesheet URLs from repo.frontend.fonts. */
  fonts: string[];
  /** Exepad build the vendored bytes came from + where its source lives
   *  (AGPL §6: conveyed object code names its Corresponding Source). */
  exepadVersion: string;
  exepadSourceUrl: string;
}

const PINNED = {
  react: '^18.3.1',
  'react-dom': '^18.3.1',
  'react-router-dom': '^6.30.0',
  sonner: '^2.0.7',
  vite: '^6.0.0',
  '@vitejs/plugin-react': '^4.5.2',
  '@tailwindcss/vite': '^4.0.0',
  tailwindcss: '^4.0.0',
  'tw-animate-css': '^1.4.0',
  typescript: '~5.9.3',
  '@types/react': '^18.3.12',
  '@types/react-dom': '^18.3.5',
  // Backend externals (the vendored server/start.mjs keeps these out of its
  // bundle). MUST match the versions the runtime worker bundles against.
  'better-sqlite3': '11.8.1',
  esbuild: '0.27.2',
};

export function packageJson(i: StandaloneInputs, hasBackend: boolean): string {
  return JSON.stringify(
    {
      name: `${i.slug}-app`,
      private: true,
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
        // With a bundled backend: run it (serves /rpc + dist/). Otherwise preview the SPA.
        start: hasBackend ? 'node server/start.mjs' : 'vite preview',
      },
      dependencies: {
        '@exepad/sdk': 'file:./vendor/exepad-sdk',
        react: PINNED.react,
        'react-dom': PINNED['react-dom'],
        'react-router-dom': PINNED['react-router-dom'],
        sonner: PINNED.sonner,
        // The vendored backend's native/binary externals — only when shipped.
        ...(hasBackend
          ? { 'better-sqlite3': PINNED['better-sqlite3'], esbuild: PINNED.esbuild }
          : {}),
      },
      devDependencies: {
        '@tailwindcss/vite': PINNED['@tailwindcss/vite'],
        tailwindcss: PINNED.tailwindcss,
        'tw-animate-css': PINNED['tw-animate-css'],
        '@types/react': PINNED['@types/react'],
        '@types/react-dom': PINNED['@types/react-dom'],
        '@vitejs/plugin-react': PINNED['@vitejs/plugin-react'],
        typescript: PINNED.typescript,
        vite: PINNED.vite,
      },
    },
    null,
    2,
  ) + '\n';
}

export const VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Single React instance (the vendored SDK declares React as a peer).
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    // Dev: proxy backend calls to the bundled server (npm start) if running.
    proxy: { '/rpc': 'http://localhost:8080', '/api': 'http://localhost:8080' },
  },
});
`;

export const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: false,
      skipLibCheck: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      allowImportingTsExtensions: false,
      noEmit: true,
      isolatedModules: true,
      allowJs: true,
    },
    include: ['src', 'app_config.json'],
  },
  null,
  2,
) + '\n';

export function indexHtml(i: StandaloneInputs): string {
  const fonts = i.fonts
    .map((u) => `    <link rel="stylesheet" href="${u.replace(/"/g, '&quot;')}" />`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${i.appName}</title>
${fonts ? '    <!-- App fonts -->\n' + fonts + '\n' : ''}  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

/** Generated per app: static imports of the entry components, keyed by name. */
export function componentsManifest(i: StandaloneInputs): string {
  const imports = i.components
    .map((c, idx) => `import C${idx} from '${c.importPath}';`)
    .join('\n');
  const entries = i.components.map((c, idx) => `  ${JSON.stringify(c.name)}: C${idx},`).join('\n');
  return `// AUTO-GENERATED — static imports of this app's entry components.
import type { ComponentType } from 'react';
${imports}

export const COMPONENTS: Record<string, ComponentType<any>> = {
${entries}
};
`;
}

export const INDEX_CSS = `/* Tailwind v4 + the app's generated theme. theme.css carries
   \`@import "tailwindcss"\` + the \`@theme\` design tokens. */
@import './code/frontend/styles/theme.css';
`;

export const MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installExepadHost } from './exepad-host';
import App from './App';
import './index.css';

// Install the SDK host globals (window.ExepadState / window.ExepadPlatform)
// BEFORE the first render so the components' SDK hooks resolve.
installExepadHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

export const APP_TSX = `import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from '@exepad/sdk/core';
import appConfig from '../app_config.json';
import { COMPONENTS } from './components-manifest';

type CfgItem = { component?: string };
type CfgPage = { slug?: string; content?: CfgItem[] };

const cfg: any = appConfig;
const fe = cfg.frontend ?? {};
const pages: CfgPage[] = Array.isArray(fe.pages) ? fe.pages : [];

function Render({ items }: { items?: CfgItem[] }) {
  if (!Array.isArray(items)) return null;
  return (
    <>
      {items.map((it, idx) => {
        const C = it?.component ? COMPONENTS[it.component] : undefined;
        if (!C) return null;
        return <C key={idx} />;
      })}
    </>
  );
}

function Shell({ page }: { page: CfgPage }) {
  return (
    <>
      <Render items={fe.header} />
      <main>
        <Render items={page.content} />
      </main>
      <Render items={fe.footer} />
    </>
  );
}

function NotFound() {
  const home = pages.find((p) => (p.slug ?? '/') === '/');
  return home ? <Shell page={home} /> : <div>Not found</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {pages.map((p, idx) => (
          <Route key={idx} path={p.slug || '/'} element={<Shell page={p} />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
      <LocationTitle />
    </BrowserRouter>
  );
}

// Keeps the platform's currentSlug in sync for the SDK navigation shim.
function LocationTitle() {
  const loc = useLocation();
  (window as any).__EXEPAD_CURRENT_SLUG__ = loc.pathname;
  return null;
}
`;

export const EXEPAD_HOST_TS = `/**
 * Standalone host: implements the two globals the Exepad SDK bridges to, so the
 * verbatim components run unchanged outside the platform.
 *
 *   window.ExepadState    — shared app state ({ getState, set, subscribe }).
 *   window.ExepadPlatform  — data/nav/theme/user surface (useModel/useHandler/…).
 *
 * Backend: data hooks call \`\${VITE_API_BASE}/rpc\` (defaults to same-origin, which
 * the bundled server in ./server serves). With no backend reachable they fail
 * soft (empty lists / null), so the UI still renders.
 */
import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import appConfig from '../app_config.json';

const API = (import.meta as any).env?.VITE_API_BASE ?? '';

// ── window.ExepadState ───────────────────────────────────────
function createState(initial: Record<string, unknown>) {
  let state = { ...initial };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    set: (key: string, value: unknown) => {
      state = { ...state, [key]: value };
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// POST a JSON-RPC envelope to the backend. The contract mirrors the platform's
// own bridge (ExposePlatformGlobal): CRUD puts \`model\` at the TOP level (not in
// params); handlers post \`{ method: handlerName, params }\`. Returns the parsed
// body, or null on network/parse error (so hooks fail soft).
async function rpc(body: Record<string, unknown>): Promise<any> {
  try {
    const res = await fetch(\`\${API}/rpc\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── ExepadPlatform.useModel ──────────────────────────────────
function useModel(name: string) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    setLoading(true);
    rpc({ method: 'sys_list', model: name, params: {} }).then((r) => {
      setData(Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : []);
      setLoading(false);
    }).catch((e) => { setError(String(e)); setLoading(false); });
  }, [name]);
  useEffect(() => { refetch(); }, [refetch]);
  return {
    data, loading, error, totalCount: data.length, refetch,
    create: async (rec: any) =>
      (await rpc({ method: 'sys_create', model: name, params: { data: rec } }))?.data ?? rec,
    update: async (id: any, up: any) =>
      (await rpc({ method: 'sys_update', model: name, params: { id: String(id), data: up } }))?.data ?? up,
    remove: async (id: any) => {
      await rpc({ method: 'sys_delete', model: name, params: { id: String(id) } });
    },
  };
}

// ── ExepadPlatform.useHandler ────────────────────────────────
function useHandler(name: string) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const execute = useCallback(async (params?: any) => {
    setLoading(true);
    try {
      // Handlers are invoked by name (the gateway maps the route name to method).
      const r = await rpc({ method: name, params: params ?? {} });
      const out = r?.data ?? r;
      setData(out); setLoading(false); return out;
    } catch (e) { setError(String(e)); setLoading(false); return null; }
  }, [name]);
  return { data, loading, error, execute, refetch: () => execute() };
}

let installed = false;
export function installExepadHost() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const cfg: any = appConfig;
  const initial = cfg.frontend?.logic?.state ?? {};

  (window as any).ExepadState = createState(initial);
  (window as any).__EXEPAD_BASE_PATH__ = '';
  (window as any).ExepadPlatform = {
    useModel,
    useHandler,
    useNavigation: () => {
      const navigate = useNavigate();
      const currentPath = (window as any).__EXEPAD_CURRENT_SLUG__ ?? '/';
      return { navigate: (p: string) => navigate(p), currentPath, currentSlug: currentPath, basePath: '' };
    },
    navigate: (p: string) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); },
    useTheme: () => (cfg.frontend?.theme ?? {}),
    useCurrentUser: () => ({ id: null, email: null, name: null, roles: [], isAuthenticated: false }),
    getBasePath: () => '',
    getAppId: () => cfg.uuid ?? cfg.alias ?? 'app',
    getRpcUrl: () => \`\${API}/rpc\`,
  };

  // Bridge the SDK's toast events to sonner (mounted by <Toaster/> in App).
  window.addEventListener('exepad:toast', (e: any) => {
    import('sonner').then(({ toast }) => {
      const d = e?.detail ?? {};
      const msg = d.message ?? d.title ?? '';
      const fn = (toast as any)[d.type] ?? toast;
      fn(msg, d.description ? { description: d.description } : undefined);
    }).catch(() => {});
  });
}

// Re-export the SDK state hook shape for any direct consumers.
export function useExepadState<T = any>(selector?: (s: any) => T): T {
  const es = (window as any).ExepadState;
  return useSyncExternalStore(
    es?.subscribe ?? (() => () => {}),
    () => (selector ? selector(es?.getState?.() ?? {}) : es?.getState?.() ?? {}),
    () => ({} as any),
  );
}
`;

export const GITIGNORE = `node_modules/
dist/
data/
.env.local
*.log
`;

export const ENV_EXAMPLE = `# Point the frontend's data hooks at a backend that serves /rpc.
# Leave blank for same-origin (the bundled ./server serves it via \`npm start\`).
VITE_API_BASE=
`;

/**
 * @param vendored     the eject-built SDK really landed in `vendor/exepad-sdk/`
 *                     (false when the exporting server had no `dist-eject`, in
 *                     which case only a placeholder README ships there).
 * @param licenseDirs  directories that actually received a LICENSE copy.
 * @param noticeDirs   directories that actually received a NOTICE copy.
 *
 * The last three exist so the readme never names a file that is not in the zip.
 */
export function readme(
  i: StandaloneInputs,
  hasBackend: boolean,
  vendored = true,
  licenseDirs: string[] = [],
  noticeDirs: string[] = [],
): string {
  const paths = (dirs: string[], file: string, sep: string) =>
    dirs.map((d) => `\`${d}/${file}\``).join(sep);
  const hasLicense = licenseDirs.length > 0;
  const hasNotice = noticeDirs.length > 0;

  // Optional bullets are joined into the list — never appended with their own
  // trailing newline (that doubled the blank line before the next heading).
  const structure = [
    '- `src/code/frontend/components/*.tsx` — your components (verbatim).',
    '- `src/code/frontend/styles/theme.css` — Tailwind v4 theme (tokens).',
    '- `app_config.json` — pages, routing, state, models, theme.',
    '- `src/App.tsx` — config-driven page assembler (slug → components).',
    '- `src/exepad-host.ts` — the SDK host shim (state + data + nav + theme).',
    '- `src/components-manifest.ts` — static imports of your components.',
    vendored
      ? '- `vendor/exepad-sdk/` — the SDK, rebuilt for vanilla builds (React is a peer).'
      : '- `vendor/exepad-sdk/` — placeholder; its README says how to fill it in.',
    ...(hasBackend ? ['- `server/` — the bundled auto-CRUD + handler backend (SQLite).'] : []),
    ...(hasLicense
      ? [`- ${paths(licenseDirs, 'LICENSE', ' + ')} — AGPL-3.0, covering the vendored Exepad code (see below).`]
      : []),
    ...(hasNotice
      ? [`- ${paths(noticeDirs, 'NOTICE', ' + ')} — third-party attributions for that same code.`]
      : []),
  ].join('\n');

  const sdkIntro = vendored
    ? 'a built copy of the Exepad SDK is vendored into `vendor/exepad-sdk`'
    : "a built copy of the Exepad SDK goes into `vendor/exepad-sdk` (that folder's README says how)";

  return `# ${i.appName} — standalone source

A complete, buildable React + Vite project generated from your Exepad app. The
components are the source the agent wrote; ${sdkIntro}
and a thin host shim (\`src/exepad-host.ts\`) provides the runtime contract, so
the project builds and runs without a running Exepad platform. The vendored SDK
is still Exepad's own code — see *Licensing*.

## Build & run

\`\`\`bash
npm install
npm run build      # → dist/ (static frontend)
${hasBackend ? 'npm start          # runs the bundled backend (serves /rpc + dist/) on :8080' : 'npm run preview    # serve the built frontend'}
\`\`\`

Dev: \`npm run dev\` (Vite on :5173).${hasBackend ? ' Run the backend separately with `npm start` (it serves /rpc), and Vite proxies to it.' : ''}

## Structure

${structure}

## Backend

Data hooks (\`useModel\`/\`useHandler\`) POST to \`\${VITE_API_BASE}/rpc\`.
${hasBackend
    ? 'The bundled `./server` serves that endpoint over the app\'s SQLite, so `npm start` runs the whole app self-contained.'
    : 'Set `VITE_API_BASE` (in `.env`) to a backend that implements the RPC contract; otherwise data hooks return empty and the UI still renders.'}

## Deploy

Build → \`dist/\` is a static SPA (host on any static host / VPS / CDN).${hasBackend ? ' Run `./server` alongside it (or behind a reverse proxy) for data.' : ''}

## Licensing

Three different things are bundled here.

**Your application is yours.** The components under \`src/code/\`, your styles and
\`app_config.json\` are your work; Exepad LLC claims no copyright interest in them
and you may license them however you like.

**The generated scaffolding is yours to keep.** \`src/exepad-host.ts\`,
\`src/App.tsx\`, \`src/main.tsx\`, \`src/components-manifest.ts\`, \`src/index.css\`,
\`vite.config.ts\` and \`index.html\` were written by Exepad LLC and are provided to
you, the recipient of this export, to use, modify and license under terms of
your choosing.

**The vendored Exepad code is Exepad's**, licensed under the GNU Affero General
Public License v3: \`vendor/exepad-sdk/\` is a built (minified) copy of the Exepad
SDK${hasBackend ? ', and `server/start.mjs` is a built copy of the Exepad app backend' : ''}.
${hasLicense ? `That licence text travels with it, in ${paths(licenseDirs, 'LICENSE', ' and ')} — it covers those vendored parts only, not your application code, which is why there is deliberately no \`LICENSE\` at the root of this project.` : 'Its licence text is the GNU AGPL-3.0: https://www.gnu.org/licenses/agpl-3.0.txt'}
${hasNotice ? `Third-party code is bundled into those built files — notably the MIT-licensed shadcn/ui-derived UI primitives — so their copyright and permission notices ride along in ${paths(noticeDirs, 'NOTICE', ' and ')}.\n` : ''}Keep ${hasNotice ? 'those notices' : 'the notice'} intact if you redistribute this project.

Those vendored parts were built from Exepad \`${i.exepadVersion}\`; their complete
corresponding source is at ${i.exepadSourceUrl}.

Exepad grants an explicit AGPL section 7 additional permission that lets you
convey your application — together with an unmodified copy of the vendored SDK${hasBackend ? ' and backend bundle' : ''} —
under terms of your choosing, without your own code becoming AGPL. The full text
is in LICENSING.md: https://github.com/Exepad/exepad-app-builder/blob/main/LICENSING.md

Generated by Exepad.
`;
}
