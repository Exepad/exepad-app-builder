/**
 * Handover-kit builder (D3): source + a structured, agent-optimized spec so a
 * coding agent (Claude Code/Cursor/Cline) can integrate the app into ANY
 * framework. Most of the kit is STATIC reference content (handover-spec.ts);
 * the per-app value is the generated MANIFEST that tells the agent exactly which
 * primitives / models / pages / theme tokens THIS app uses.
 */
import { strToU8 } from 'fflate';
import type { Env } from '../../types/env';
import { enumerateSource, appNameOf, slug, readEntryBytes } from './source-set';
import {
  SDK_PRIMITIVES_MD,
  DATA_CONTRACT_MD,
  THEME_MD,
  RECIPES,
  INTEGRATION_CHECKLIST_MD,
  buildAgentsMd,
} from './templates/handover-spec';

const dec = new TextDecoder();

export interface HandoverManifest {
  app: { name: string; slug: string };
  pages: { slug: string; title: string }[];
  state: string[];
  models: { name: string; fields: { name: string; type: string; nullable: boolean }[] }[];
  handlers: string[];
  fonts: string[];
  theme: { tokens: string[] };
  /** SDK subpath → the symbols this app actually imports from it. */
  sdkUsage: Record<string, string[]>;
  files: string[];
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Parse `import … from '@exepad/sdk[/sub]'` clauses → used symbols per subpath. */
function scanSdkUsage(sourceFiles: Record<string, Uint8Array>): Record<string, string[]> {
  const usage = new Map<string, Set<string>>();
  const importRe = /import\s+([^;]*?)\s+from\s+['"]@exepad\/sdk(?:\/([\w-]+))?['"]/g;
  for (const bytes of Object.values(sourceFiles)) {
    const text = dec.decode(bytes);
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(text)) !== null) {
      const clause = m[1].trim();
      const sub = m[2] || 'index';
      const set = usage.get(sub) ?? new Set<string>();
      // Named: { A, B as C } — take the imported (left) name.
      const named = clause.match(/\{([^}]*)\}/);
      if (named) {
        for (const part of named[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (name) set.add(name);
        }
      }
      // Namespace: * as NS
      const ns = clause.match(/\*\s+as\s+([\w$]+)/);
      if (ns) set.add(`* as ${ns[1]}`);
      // Default import (leading identifier before a comma or the `{`).
      const def = clause.match(/^([\w$]+)\s*(?:,|$)/);
      if (def && !clause.startsWith('{') && !clause.startsWith('*')) set.add(def[1]);
      usage.set(sub, set);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of [...usage.entries()].sort()) out[k] = [...v].sort();
  return out;
}

/** Pull declared design-token names (`--foo: …`) from the theme stylesheet. */
function extractThemeTokens(themeCss: string | undefined): string[] {
  if (!themeCss) return [];
  const tokens = new Set<string>();
  const re = /--([a-z0-9-]+)\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(themeCss)) !== null) tokens.add(`--${m[1]}`);
  return [...tokens].sort();
}

function buildManifest(
  configRaw: string,
  sourceFiles: Record<string, Uint8Array>,
): HandoverManifest {
  let cfg: Record<string, any> = {};
  try {
    cfg = JSON.parse(configRaw);
  } catch {
    cfg = {};
  }
  const frontend = cfg.frontend ?? {};
  const backend = cfg.backend ?? cfg.repo?.backend ?? {};
  const repo = cfg.repo ?? {};

  const pages = Array.isArray(frontend.pages)
    ? frontend.pages.map((p: any) => ({ slug: String(p?.slug ?? ''), title: String(p?.title ?? '') }))
    : [];
  const state = frontend.logic?.state ? Object.keys(frontend.logic.state) : [];
  // Model schema lives under `columns` (agent config) — older shapes used
  // `fields`; accept either. Each column: { name, type, isNullable, … }.
  const models = Array.isArray(backend.models)
    ? backend.models.map((m: any) => {
        const cols = Array.isArray(m?.columns)
          ? m.columns
          : Array.isArray(m?.fields)
            ? m.fields
            : [];
        return {
          name: String(m?.name ?? ''),
          fields: cols
            .map((f: any) => ({
              name: String(f?.name ?? ''),
              type: String(f?.type ?? 'text'),
              nullable: f?.isNullable ?? f?.nullable ?? true,
            }))
            .filter((f: { name: string }) => f.name),
        };
      })
    : [];
  const handlers = repo.backend?.handlers
    ? Object.keys(repo.backend.handlers)
    : backend.handlers
      ? Object.keys(backend.handlers)
      : [];
  const fonts = Array.isArray(repo.frontend?.fonts) ? repo.frontend.fonts.map(String) : [];

  // theme tokens from the theme.css source if present
  const themeKey = Object.keys(sourceFiles).find((p) => p.endsWith('styles/theme.css'));
  const themeCss = themeKey ? dec.decode(sourceFiles[themeKey]) : undefined;

  return {
    app: { name: appNameOf(configRaw), slug: slug(appNameOf(configRaw)) },
    pages,
    state,
    models,
    handlers,
    fonts,
    theme: { tokens: extractThemeTokens(themeCss) },
    sdkUsage: scanSdkUsage(sourceFiles),
    files: Object.keys(sourceFiles).sort(),
  };
}

function manifestMarkdown(m: HandoverManifest): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `\`${x}\``).join(', ') : '_(none)_');
  const sdk = Object.entries(m.sdkUsage)
    .map(([sub, syms]) => `- \`@exepad/sdk/${sub === 'index' ? '' : sub}\`: ${list(syms)}`)
    .join('\n');
  return `# ${m.app.name} — app manifest

What THIS app uses (translate only these). See \`spec/\` for how to map each.

## Pages / routes
${m.pages.map((p) => `- \`${p.slug || '/'}\`${p.title ? ` — ${p.title}` : ''}`).join('\n') || '_(none)_'}

## Shared state (\`frontend.logic.state\`)
${list(m.state)}

## Backend models (auto-CRUD)
${
    m.models
      .map((mm) => {
        const fields = mm.fields.length
          ? mm.fields
              .map((f) => `\`${f.name}\`: ${f.type}${f.nullable ? '' : ' (required)'}`)
              .join(', ')
          : '_(no fields)_';
        return `- **${mm.name}** — ${fields}`;
      })
      .join('\n') || '_(none)_'
  }

## Handlers (custom server logic)
${list(m.handlers)}

## SDK primitives used (per subpath)
${sdk || '_(none)_'}

## Theme tokens
${list(m.theme.tokens)}

## Fonts
${m.fonts.map((f) => `- ${f}`).join('\n') || '_(none)_'}

## Source files
${m.files.map((f) => `- \`${f}\``).join('\n')}
`;
}

function manifestSummary(m: HandoverManifest): string {
  const subs = Object.keys(m.sdkUsage).join(', ') || 'none';
  return [
    `- **${m.pages.length}** page(s), **${m.models.length}** model(s), **${m.handlers.length}** handler(s), **${m.state.length}** state key(s).`,
    `- SDK subpaths used: ${subs}.`,
    `- ${m.files.length} source file(s); ${m.theme.tokens.length} theme token(s); ${m.fonts.length} font(s).`,
  ].join('\n');
}

/**
 * Build the handover kit. Returns null when the app has no source yet.
 */
export async function buildHandoverKit(
  env: Env,
  appId: string,
): Promise<{ files: Record<string, Uint8Array>; appName: string } | null> {
  const { configRaw, entries } = await enumerateSource(env, appId);
  if (configRaw == null) return null;

  const { files: sourceFiles } = await readEntryBytes(env, entries);
  const manifest = buildManifest(configRaw, sourceFiles);
  const appName = manifest.app.name;

  const out: Record<string, Uint8Array> = {};
  // Verbatim source under code/…
  for (const [p, b] of Object.entries(sourceFiles)) out[p] = b;
  // Structure
  out['app_config.json'] = strToU8(prettyJson(configRaw));
  // Per-app manifest
  out['MANIFEST.json'] = strToU8(JSON.stringify(manifest, null, 2));
  out['MANIFEST.md'] = strToU8(manifestMarkdown(manifest));
  // Agent entrypoint (+ tool aliases)
  out['AGENTS.md'] = strToU8(buildAgentsMd(appName, manifestSummary(manifest)));
  out['CLAUDE.md'] = strToU8('See [AGENTS.md](AGENTS.md) for integration instructions.\n');
  out['.cursorrules'] = strToU8('Read AGENTS.md and follow its steps to integrate this app.\n');
  // Static spec
  out['spec/sdk-primitives.md'] = strToU8(SDK_PRIMITIVES_MD);
  out['spec/data-contract.md'] = strToU8(DATA_CONTRACT_MD);
  out['spec/theme.md'] = strToU8(THEME_MD);
  for (const [name, content] of Object.entries(RECIPES)) {
    out[`spec/recipes/${name}`] = strToU8(content);
  }
  out['INTEGRATION_CHECKLIST.md'] = strToU8(INTEGRATION_CHECKLIST_MD);

  return { files: out, appName };
}
