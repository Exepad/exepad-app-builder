/**
 * Materialize an agent build into local storage, ready for the deploy pipeline.
 *
 * In the Cloudflare/Django topology the Django backend pulled the agent's GCS
 * output, compiled component/handler TSX → JS, and wrote everything to R2 under
 * `{appId}/...` keys before calling `/api/deploy`. Self-host has no Django and
 * no GCS, so this module reproduces that step: it takes the artifact map from
 * the agent's `GET /artifacts/{session}` (TSX sources + theme/compiled CSS +
 * seed CSV + the assembled `app_config.json`), compiles TSX → JS with the same
 * esbuild profiles the cloud used (`@exepad/deploy-utils` bundle helpers), and
 * writes the sources + compiled output + config to the storage adapter using
 * the exact keys the assembled config references.
 *
 * The deploy pipeline (`routes/deploy.ts`) then reads compiled handler `.js`
 * from `{appId}/compiled/backend/handlers/{m}.js`, and the runtime serves
 * compiled component `.js` from `{appId}/compiled/frontend/components/{n}.js`.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { compileComponent, compileHandlerSource } from '@exepad/deploy-utils/bundle';
import { isValidIdentifier, VALID_IDENTIFIER_PATTERN } from '@exepad/types';
import type { Env } from '../types/env';

/**
 * Component/module/handler/seed names come straight from the agent-produced
 * config's object keys and are used to build filesystem paths (writeFileSync
 * into the temp stage dir) and generated import specifiers. The config schema
 * does NOT constrain these keys, so without validation a key like
 * `../../../../data/secrets/env` would make `join(stageDir, name + '.tsx')`
 * resolve OUTSIDE the stage dir — an arbitrary-path write. Reject anything that
 * is not a plain identifier before it touches the filesystem.
 */
function assertSafeArtifactName(kind: string, name: string): void {
  if (typeof name !== 'string' || !isValidIdentifier(name)) {
    throw new Error(
      `Illegal ${kind} name ${JSON.stringify(name)}: must match ${VALID_IDENTIFIER_PATTERN}`,
    );
  }
}

/** Belt-and-suspenders: assert a path stays inside the stage dir before writing. */
function assertInsideStageDir(stageDir: string, target: string): void {
  const root = resolve(stageDir) + sep;
  if (!resolve(target).startsWith(root)) {
    throw new Error(`Refusing to write outside the build stage dir: ${target}`);
  }
}

/** Artifact map shape returned by the agent's `/artifacts/{session}` endpoint. */
export type ArtifactValue = string | { mime_type?: string; base64?: string };
export type ArtifactMap = Record<string, ArtifactValue>;

export interface MaterializeResult {
  appConfig: Record<string, unknown>;
  /** Relative config key (under `{appId}/`) to pass as the deploy `configPath`. */
  configPath: string;
}

interface RepoEntry {
  type?: string;
  source?: string;
  compiled?: string;
  format?: string;
  supporting_modules?: string[];
}

/**
 * Strip build-time-only directives that must never reach the browser.
 *
 * Tailwind v4 source CSS starts with bare-specifier `@import "tailwindcss"` /
 * `@import "tw-animate-css"` and `@source "..."` directives — these are meant to
 * be expanded by the Tailwind compiler at build time. When the final compile
 * gate fails (missing binary, CSS error, timeout, …) the agent emits no
 * `codefocus_style:compiled.css` artifact and we fall back to the raw theme.css.
 * Shipping that verbatim makes the browser fire doomed relative requests
 * (`/a/<id>/tailwindcss`) that 404 to the SPA shell, get refused for the wrong
 * MIME type, and leave the app effectively unstyled (large CLS).
 *
 * A correctly compiled stylesheet never contains these directives, so this is a
 * no-op on good output and a guardrail on the fallback. URL/relative `@import`s
 * (e.g. `@import url(https://fonts.googleapis.com/...)`) are preserved.
 */
function stripBuildTimeCssDirectives(css: string): { css: string; stripped: number } {
  let stripped = 0;
  const cleaned = css
    // `@source "./components";` — Tailwind class-scanner directive, build-only.
    .replace(/^[ \t]*@source\b[^;]*;[ \t]*$\n?/gim, () => {
      stripped++;
      return '';
    })
    // Bare-specifier `@import "tailwindcss";` / `@import 'tw-animate-css';`.
    // Only bare package specifiers (no `url(`, no scheme, no leading `./`,`/`).
    .replace(/^[ \t]*@import\s+["']([^"']+)["'][^;]*;[ \t]*$\n?/gim, (match, spec) => {
      const isResolvable = /^(?:url\(|https?:|\.{0,2}\/)/i.test(String(spec).trim());
      if (isResolvable) return match;
      stripped++;
      return '';
    });
  return { css: cleaned, stripped };
}

const CONTENT_TYPES: Record<string, string> = {
  tsx: 'text/plain; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  js: 'application/javascript',
  css: 'text/css',
  csv: 'text/csv',
  json: 'application/json',
};

function contentTypeFor(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Decode an artifact value (string passthrough; base64 blobs → utf-8). */
function artifactText(value: ArtifactValue | undefined): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.base64 === 'string') {
    return Buffer.from(value.base64, 'base64').toString('utf-8');
  }
  return null;
}

async function putStorage(
  env: Env,
  key: string,
  content: string,
): Promise<void> {
  await env.CONFIG_CACHE.put(key, content, {
    httpMetadata: { contentType: contentTypeFor(key) },
  });
}

export async function materializeBuild(
  env: Env,
  appId: string,
  artifacts: ArtifactMap,
  options?: { configKey?: string },
): Promise<MaterializeResult> {
  const configRaw = artifactText(artifacts['app_config.json']);
  if (!configRaw) {
    throw new Error(
      'Agent build produced no app_config.json artifact — cannot materialize.',
    );
  }
  let appConfig: Record<string, unknown>;
  try {
    appConfig = JSON.parse(configRaw) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`app_config.json is not valid JSON: ${e}`);
  }

  const repo = (appConfig.repo as Record<string, unknown> | undefined) ?? {};
  const frontend = (repo.frontend as Record<string, unknown> | undefined) ?? {};
  const backend = (repo.backend as Record<string, unknown> | undefined) ?? {};
  const components =
    (frontend.components as Record<string, RepoEntry> | undefined) ??
    (repo.components as Record<string, RepoEntry> | undefined) ??
    {};
  const handlers =
    (backend.handlers as Record<string, RepoEntry> | undefined) ??
    (repo.methods as Record<string, RepoEntry> | undefined) ??
    {};
  const styles = (frontend.styles as Record<string, RepoEntry> | undefined) ?? {};
  const seed = (repo.seed as Record<string, RepoEntry> | undefined) ?? {};

  // ── Validate every agent-controlled name that becomes a filesystem path or a
  //    generated import specifier BEFORE any write. See assertSafeArtifactName.
  for (const name of Object.keys(components)) assertSafeArtifactName('component', name);
  for (const entry of Object.values(components)) {
    for (const mod of entry.supporting_modules ?? []) {
      if (typeof mod === 'string' && mod) assertSafeArtifactName('supporting module', mod);
    }
  }
  for (const method of Object.keys(handlers)) assertSafeArtifactName('handler', method);
  for (const name of Object.keys(seed)) assertSafeArtifactName('seed', name);

  // ── Stage all component + supporting-module TSX into one flat tmp dir so the
  //    esbuild bundle resolves `import { X } from "./ModuleName"` against
  //    `ModuleName.tsx` (the agent's sibling-module convention).
  const stageDir = mkdtempSync(join(tmpdir(), `exepad-build-${appId}-`));
  try {
    const componentTsx = new Map<string, string>(); // name → source
    for (const name of Object.keys(components)) {
      const src = artifactText(artifacts[`codefocus_component:${name}.tsx`]);
      if (src == null) {
        throw new Error(`Missing component artifact: codefocus_component:${name}.tsx`);
      }
      componentTsx.set(name, src);
    }

    // Supporting modules: stage every module artifact present (referenced by any
    // component entry). Modules are inlined into each component bundle, not
    // emitted separately.
    const moduleNames = new Set<string>();
    for (const entry of Object.values(components)) {
      for (const mod of entry.supporting_modules ?? []) {
        if (typeof mod === 'string' && mod) moduleNames.add(mod);
      }
    }
    for (const mod of moduleNames) {
      const src = artifactText(artifacts[`codefocus_module:${mod}.tsx`]);
      if (src == null) {
        throw new Error(`Missing supporting module artifact: codefocus_module:${mod}.tsx`);
      }
      const modPath = join(stageDir, `${mod}.tsx`);
      assertInsideStageDir(stageDir, modPath);
      writeFileSync(modPath, src, 'utf-8');
      // Persist the module source alongside the entry components (same flat dir)
      // so the read-only Source browser/zip can serve it and the entry's
      // `import { X } from './Mod'` resolves against a real sibling file.
      // Modules are otherwise inlined into the entry bundle and never written
      // to storage — only NEW builds gain a persisted module source key.
      await putStorage(env, `${appId}/code/frontend/components/${mod}.tsx`, src);
    }
    for (const [name, src] of componentTsx) {
      const tsxPath = join(stageDir, `${name}.tsx`);
      assertInsideStageDir(stageDir, tsxPath);
      writeFileSync(tsxPath, src, 'utf-8');
    }

    // ── Compile + write components (source .tsx + bundled .js).
    for (const [name, entry] of Object.entries(components)) {
      const src = componentTsx.get(name)!;
      const sourceKey = `${appId}/${entry.source ?? `code/frontend/components/${name}.tsx`}`;
      const compiledRel = entry.compiled ?? `compiled/frontend/components/${name}.js`;
      await putStorage(env, sourceKey, src);

      const outPath = join(stageDir, `${name}.bundle.js`);
      const result = await compileComponent(join(stageDir, `${name}.tsx`), outPath);
      if (!result.success) {
        throw new Error(
          `Component "${name}" failed to compile: ${(result.errors || []).join('; ')}`,
        );
      }
      const js = readFileSync(outPath, 'utf-8');
      await putStorage(env, `${appId}/${compiledRel}`, js);
    }

    // ── Compile + write handlers (source .tsx + transformed .js).
    for (const [method, entry] of Object.entries(handlers)) {
      const src = artifactText(artifacts[`handler_code:${method}.tsx`]);
      if (src == null) {
        throw new Error(`Missing handler artifact: handler_code:${method}.tsx`);
      }
      const sourceKey = `${appId}/${entry.source ?? `code/backend/handlers/${method}.tsx`}`;
      const compiledRel = entry.compiled ?? `compiled/backend/handlers/${method}.js`;
      await putStorage(env, sourceKey, src);

      const result = await compileHandlerSource(src, 'tsx');
      if (!result.success || !result.code) {
        throw new Error(
          `Handler "${method}" failed to compile: ${(result.errors || []).join('; ')}`,
        );
      }
      await putStorage(env, `${appId}/${compiledRel}`, result.code);
    }

    // ── Styles. The theme "compiled" is the theme.css itself; the Tailwind
    //    output is the separate `compiled.css` artifact (fall back to theme.css
    //    so a missing final-compile-gate artifact never ships a blank stylesheet).
    const themeCss = artifactText(artifacts['codefocus_style:theme.css']);
    const compiledArtifact = artifactText(artifacts['codefocus_style:compiled.css']);
    const usingFallback = compiledArtifact == null && themeCss != null;
    const compiledCss = compiledArtifact ?? themeCss;
    const themeEntry = styles.theme;
    const compiledEntry = styles.compiled;
    // The runtime fetches `compiled/frontend/styles/theme.css` at render time, so
    // those keys must never dangle. Normally `themeCss` is present; if a build
    // shipped only the Tailwind output (no theme.css source artifact), fall back
    // to it so the theme.css URL serves valid CSS instead of 404-ing the app into
    // an unstyled state. (The agent also now always persists a theme.css — this is
    // the deploy-side belt-and-suspenders.)
    const themeSourceContent = themeCss ?? compiledArtifact;
    if (themeSourceContent != null) {
      const themeSource = `${appId}/${themeEntry?.source ?? 'code/frontend/styles/theme.css'}`;
      const themeCompiled = `${appId}/${themeEntry?.compiled ?? 'compiled/frontend/styles/theme.css'}`;
      await putStorage(env, themeSource, themeSourceContent);
      await putStorage(env, themeCompiled, themeSourceContent);
    }
    if (compiledCss != null) {
      // Never ship build-time-only directives to the browser. On the fallback
      // path (compile gate produced no artifact) the raw theme.css would
      // otherwise emit bare `@import "tailwindcss"`/`@source` that 404 in the
      // browser and leave the app unstyled. Stripping is a no-op on properly
      // compiled CSS.
      const { css: safeCompiledCss, stripped } = stripBuildTimeCssDirectives(compiledCss);
      if (usingFallback) {
        console.error(
          `[materialize] app ${appId}: final Tailwind compile produced no ` +
            `compiled.css artifact — shipping theme.css fallback with ${stripped} ` +
            `build-time directive(s) stripped. The app will lack Tailwind utilities ` +
            `until rebuilt; check the agent's final compile gate (tailwindcss binary + ` +
            `tw-animate-css resolution).`,
        );
      }
      const compiledKey = `${appId}/${compiledEntry?.compiled ?? 'compiled/frontend/styles/compiled.css'}`;
      await putStorage(env, compiledKey, safeCompiledCss);
    }

    // ── Seed CSV (config is source of truth for which seeds to write). The
    //    agent emits `seed:{name}.csv` artifacts; write each to the path its
    //    config entry references. A seed entry without an artifact is skipped
    //    (deploy seeding tolerates absent seeds).
    for (const [name, entry] of Object.entries(seed)) {
      const csv = artifactText(artifacts[`seed:${name}.csv`]);
      if (csv == null) continue;
      const sourceKey = `${appId}/${entry.source ?? `code/seed/${name}.csv`}`;
      await putStorage(env, sourceKey, csv);
    }

    // ── App config last, so the deploy reads a fully-staged build.
    const configPath = options?.configKey ?? 'preview/app-config.json';
    await putStorage(env, `${appId}/${configPath}`, JSON.stringify(appConfig));

    return { appConfig, configPath };
  } finally {
    try {
      rmSync(stageDir, { recursive: true, force: true });
    } catch {
      /* best-effort tmp cleanup */
    }
  }
}
