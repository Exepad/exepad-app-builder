/**
 * Extension Registry
 *
 * Maps extension IDs to CDN URLs.
 *
 * Production: pre-built bundles on cdn.exepad.com (externalizes React via window.React)
 * Development: esm.sh proxy with ?external=react,react-dom for React-dependent packages
 *
 * The import map in layout.tsx also includes "react" and "react-dom" entries
 * pointing to local shims that re-export window.React/ReactDOM, so esm.sh
 * externalized imports resolve correctly.
 */

const isDev = import.meta.env.MODE !== 'production';

// esm.sh suffix for React-dependent packages.
// Only externalize react and react-dom — esm.sh doesn't support subpath externals.
const EXT_REACT = '?external=react,react-dom';

/**
 * Production URLs — pre-built extension bundles on CDN
 */
const PRODUCTION_REGISTRY: Record<string, string> = {
  // --- Data Visualization ---
  d3: 'https://cdn.exepad.com/sdk/ext/d3@7.js',
  plotly: 'https://cdn.exepad.com/sdk/ext/plotly@2.js',
  cytoscape: 'https://cdn.exepad.com/sdk/ext/cytoscape@3.js',

  // --- Code Editing ---
  monaco: 'https://cdn.exepad.com/sdk/ext/monaco@0.50.js',
  codemirror: 'https://cdn.exepad.com/sdk/ext/codemirror@6.js',
  highlight: 'https://cdn.exepad.com/sdk/ext/highlight@11.js',
  prism: 'https://cdn.exepad.com/sdk/ext/prism@2.js',

  // --- Rich Text Editing ---
  tiptap: 'https://cdn.exepad.com/sdk/ext/tiptap@3.js',
  slate: 'https://cdn.exepad.com/sdk/ext/slate@0.100.js',
  prosemirror: 'https://cdn.exepad.com/sdk/ext/prosemirror@1.js',

  // --- Canvas / Drawing ---
  konva: 'https://cdn.exepad.com/sdk/ext/konva@9.js',
  fabric: 'https://cdn.exepad.com/sdk/ext/fabric@6.js',
  excalidraw: 'https://cdn.exepad.com/sdk/ext/excalidraw@0.17.js',
  signature: 'https://cdn.exepad.com/sdk/ext/signature-pad@5.js',
  cropper: 'https://cdn.exepad.com/sdk/ext/react-cropper@2.js',

  // --- Drag and Drop ---
  'dnd-kit': 'https://cdn.exepad.com/sdk/ext/dnd-kit@6.js',

  // --- Maps ---
  mapbox: 'https://cdn.exepad.com/sdk/ext/mapbox-gl@3.js',
  leaflet: 'https://cdn.exepad.com/sdk/ext/leaflet@1.9.js',

  // --- 3D / WebGL ---
  three: 'https://cdn.exepad.com/sdk/ext/three@0.170.js',
  pixi: 'https://cdn.exepad.com/sdk/ext/pixi@8.js',

  // --- Diagrams / Flows ---
  reactflow: 'https://cdn.exepad.com/sdk/ext/reactflow@12.js',
  mermaid: 'https://cdn.exepad.com/sdk/ext/mermaid@11.js',

  // --- Documents ---
  pdf: 'https://cdn.exepad.com/sdk/ext/react-pdf@9.js',
  markdown: 'https://cdn.exepad.com/sdk/ext/react-markdown@9.js',
  katex: 'https://cdn.exepad.com/sdk/ext/katex@0.16.js',

  // --- Media ---
  wavesurfer: 'https://cdn.exepad.com/sdk/ext/wavesurfer@7.js',
  videojs: 'https://cdn.exepad.com/sdk/ext/videojs@8.js',
  tone: 'https://cdn.exepad.com/sdk/ext/tone@15.js',
  lottie: 'https://cdn.exepad.com/sdk/ext/lottie-react@2.js',

  // --- Advanced UI ---
  'ag-grid': 'https://cdn.exepad.com/sdk/ext/ag-grid@32.js',
  fullcalendar: 'https://cdn.exepad.com/sdk/ext/fullcalendar@6.js',
  'tanstack-table': 'https://cdn.exepad.com/sdk/ext/tanstack-table@8.js',
  xterm: 'https://cdn.exepad.com/sdk/ext/xterm@5.js',

  // --- Utilities ---
  qrcode: 'https://cdn.exepad.com/sdk/ext/qrcode-react@4.js',
  barcode: 'https://cdn.exepad.com/sdk/ext/react-barcode@1.js',
  chess: 'https://cdn.exepad.com/sdk/ext/chess@1.js',
};

/**
 * Development URLs — esm.sh proxy for npm packages
 * React-dependent packages use ?external=react,react-dom so they
 * import from the "react"/"react-dom" import map entries (our shims).
 */
const DEVELOPMENT_REGISTRY: Record<string, string> = {
  // --- Data Visualization ---
  d3: '/runtime_assets/ext/d3-shim.js',
  plotly: '/runtime_assets/ext/plotly-shim.js',
  cytoscape: '/runtime_assets/ext/cytoscape-shim.js',

  // --- Code Editing ---
  monaco: '/runtime_assets/ext/monaco-shim.js',
  codemirror: '/runtime_assets/ext/codemirror-shim.js',
  highlight: '/runtime_assets/ext/highlight-shim.js',
  prism: '/runtime_assets/ext/prism-shim.js',

  // --- Rich Text Editing ---
  tiptap: '/runtime_assets/ext/tiptap-shim.js',
  slate: '/runtime_assets/ext/slate-shim.js',
  prosemirror: '/runtime_assets/ext/prosemirror-shim.js',

  // --- Canvas / Drawing ---
  konva: 'https://esm.sh/react-konva@18' + EXT_REACT,
  fabric: '/runtime_assets/ext/fabric-shim.js',
  excalidraw: '/runtime_assets/ext/excalidraw-shim.js',
  signature: '/runtime_assets/ext/signature-shim.js',
  cropper: '/runtime_assets/ext/cropper-shim.js',

  // --- Drag and Drop ---
  'dnd-kit': '/runtime_assets/ext/dnd-kit-shim.js',

  // --- Maps ---
  mapbox: 'https://esm.sh/react-map-gl@7' + EXT_REACT,
  leaflet: '/runtime_assets/ext/leaflet-shim.js',

  // --- 3D / WebGL (clean exports, no shim needed) ---
  three: 'https://esm.sh/three@0.170',
  pixi: 'https://esm.sh/pixi.js@8',

  // --- Diagrams / Flows ---
  reactflow: '/runtime_assets/ext/reactflow-shim.js',
  mermaid: '/runtime_assets/ext/mermaid-shim.js',

  // --- Documents ---
  pdf: '/runtime_assets/ext/pdf-shim.js',
  markdown: '/runtime_assets/ext/markdown-shim.js',
  katex: 'https://esm.sh/katex@0.16',

  // --- Media ---
  wavesurfer: '/runtime_assets/ext/wavesurfer-shim.js',
  videojs: '/runtime_assets/ext/videojs-shim.js',
  tone: 'https://esm.sh/tone@14',
  lottie: '/runtime_assets/ext/lottie-shim.js',

  // --- Advanced UI ---
  'ag-grid': '/runtime_assets/ext/ag-grid-shim.js',
  fullcalendar: '/runtime_assets/ext/fullcalendar-shim.js',
  'tanstack-table': '/runtime_assets/ext/tanstack-table-shim.js',
  xterm: '/runtime_assets/ext/xterm-shim.js',

  // --- Utilities ---
  qrcode: '/runtime_assets/ext/qrcode-shim.js',
  barcode: '/runtime_assets/ext/barcode-shim.js',
  chess: 'https://esm.sh/chess.js@1',
};

// Self-host serves everything same-origin, so extensions resolve to the bundled
// local shims under /runtime_assets/ext/* (which ship in the image). The CDN
// registry (cdn.exepad.com) is opt-in for the Cloudflare cloud build via
// VITE_EXTENSION_REGISTRY=cdn — otherwise importing an extension would 404.
const useCdnRegistry = import.meta.env.VITE_EXTENSION_REGISTRY === 'cdn';
export const EXTENSION_REGISTRY: Record<string, string> =
  useCdnRegistry && !isDev ? PRODUCTION_REGISTRY : DEVELOPMENT_REGISTRY;

/**
 * CSS stylesheets required by specific extensions.
 * Extensions not listed here don't need external CSS.
 * Each entry maps an extension ID to an array of CSS URLs to load.
 */
export const EXTENSION_CSS_REGISTRY: Record<string, string[]> = {
  'ag-grid': [
    'https://cdn.jsdelivr.net/npm/ag-grid-community@32/styles/ag-grid.min.css',
    'https://cdn.jsdelivr.net/npm/ag-grid-community@32/styles/ag-theme-alpine.min.css',
  ],
  xterm: [
    'https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css',
  ],
  leaflet: [
    'https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.min.css',
  ],
  katex: [
    'https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css',
  ],
  videojs: [
    'https://cdn.jsdelivr.net/npm/video.js@8/dist/video-js.min.css',
  ],
  fullcalendar: [
    'https://cdn.jsdelivr.net/npm/@fullcalendar/core@6/main.min.css',
    'https://cdn.jsdelivr.net/npm/@fullcalendar/daygrid@6/main.min.css',
    'https://cdn.jsdelivr.net/npm/@fullcalendar/timegrid@6/main.min.css',
    'https://cdn.jsdelivr.net/npm/@fullcalendar/list@6/main.min.css',
  ],
  mapbox: [
    'https://cdn.jsdelivr.net/npm/mapbox-gl@3/dist/mapbox-gl.css',
  ],
  reactflow: [
    'https://cdn.jsdelivr.net/npm/reactflow@11/dist/style.min.css',
  ],
  cropper: [
    'https://cdn.jsdelivr.net/npm/cropperjs@1/dist/cropper.min.css',
  ],
};

/**
 * Resolve an extension ID to its CDN URL.
 * Returns undefined for unknown extensions.
 */
export function resolveExtensionUrl(extensionId: string): string | undefined {
  return EXTENSION_REGISTRY[extensionId];
}

/**
 * Resolve an extension ID to its required CSS URLs.
 * Returns an empty array if the extension needs no CSS.
 */
export function resolveExtensionCssUrls(extensionId: string): string[] {
  return EXTENSION_CSS_REGISTRY[extensionId] || [];
}

/**
 * Get all known extension IDs.
 */
export function getKnownExtensions(): string[] {
  return Object.keys(EXTENSION_REGISTRY);
}
