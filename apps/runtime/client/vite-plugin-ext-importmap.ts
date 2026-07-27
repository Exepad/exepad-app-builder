/**
 * Vite plugin: inject @exepad/ext-* import map entries from extensionRegistry.ts
 *
 * Reads the DEVELOPMENT_REGISTRY (dev) or PRODUCTION_REGISTRY (prod) from
 * extensionRegistry.ts and injects @exepad/ext-{id} → URL entries into the
 * import map in index.html.
 *
 * This keeps extensionRegistry.ts as the single source of truth for extension URLs.
 */

import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

/**
 * Parse a registry block from extensionRegistry.ts.
 * Extracts key-value pairs from TypeScript object literal syntax.
 */
function parseRegistry(source: string, blockName: string): Record<string, string> {
  // Match: const BLOCK_NAME: Record<...> = { ... };
  const blockRegex = new RegExp(
    `${blockName}[^=]*=\\s*\\{([\\s\\S]*?)\\};`,
    'm'
  );
  const match = source.match(blockRegex);
  if (!match) return {};

  const body = match[1];
  const entries: Record<string, string> = {};

  // Match lines like:   'd3': 'https://esm.sh/d3@7',
  // or:                  d3: 'https://esm.sh/d3@7' + EXT_REACT,
  // or:                  'dnd-kit': 'https://esm.sh/...' + EXT_REACT,
  for (const line of body.split('\n')) {
    const m = line.match(
      /['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]\s*(?:\+\s*EXT_REACT)?\s*,?/
    );
    if (!m) continue;

    const id = m[1];
    let url = m[2];

    // If the line has + EXT_REACT, append the suffix
    if (/\+\s*EXT_REACT/.test(line)) {
      url += '?external=react,react-dom';
    }

    entries[id] = url;
  }

  return entries;
}

export function extImportMapPlugin(): Plugin {
  return {
    name: 'exepad-ext-importmap',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const registryPath = path.resolve(
          __dirname,
          'src/lib/extensionRegistry.ts'
        );

        let source: string;
        try {
          source = fs.readFileSync(registryPath, 'utf-8');
        } catch {
          console.warn('[ext-importmap] Could not read extensionRegistry.ts');
          return html;
        }

        // Default to the local /runtime_assets/ext shims (self-host serves them
        // same-origin). The cdn.exepad.com map is opt-in for the cloud build via
        // VITE_EXTENSION_REGISTRY=cdn — baking CDN URLs into a self-host image's
        // import map would 404 every extension import.
        const useCdn = process.env.VITE_EXTENSION_REGISTRY === 'cdn' && ctx.server === undefined;
        const registryName = useCdn
          ? 'PRODUCTION_REGISTRY'
          : 'DEVELOPMENT_REGISTRY';
        const registry = parseRegistry(source, registryName);

        if (Object.keys(registry).length === 0) {
          console.warn(
            `[ext-importmap] No entries found in ${registryName}`
          );
          return html;
        }

        // Build the extension import entries
        const extEntries: Record<string, string> = {};
        for (const [id, url] of Object.entries(registry)) {
          extEntries[`@exepad/ext-${id}`] = url;
        }

        // Find and patch the import map
        const importMapRegex =
          /(<script\s+type="importmap"\s*>)\s*(\{[\s\S]*?\})\s*(<\/script>)/;
        const mapMatch = html.match(importMapRegex);

        if (!mapMatch) {
          console.warn('[ext-importmap] No import map found in index.html');
          return html;
        }

        const existingMap = JSON.parse(mapMatch[2]);
        const mergedImports = {
          ...existingMap.imports,
          ...extEntries,
        };
        existingMap.imports = mergedImports;

        const newMapJson = JSON.stringify(existingMap, null, 6);
        const newScript = `${mapMatch[1]}\n      ${newMapJson}\n    ${mapMatch[3]}`;

        return html.replace(importMapRegex, newScript);
      },
    },
  };
}
