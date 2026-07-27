// One-shot / deploy-time generator: render a published page's first fold to a
// hydration-correct `#root` HTML artifact and write it to storage under
// `{appId}/{publishedPrefix}/prerender/{slug}.html` (mirrors the SEO snapshot
// key). The meta-injector injects it into the shell when EXEPAD_PRERENDER=1.
//
// Usage:
//   node packages/deploy-utils/src/ssr/generate-prerender.mjs <appId> <slug> [--repo <root>] [--data <dir>]
//   e.g. node .../generate-prerender.mjs ag35xetdj /about

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { renderAppPageToHtml } from './renderAppPage.mjs';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const appId = process.argv[2];
const slug = process.argv[3] || '/';
if (!appId) {
  console.error('usage: generate-prerender.mjs <appId> <slug> [--repo <root>] [--data <dir>]');
  process.exit(1);
}

const repoRoot = arg('--repo', join(process.cwd()));
const dataDir = arg('--data', process.env.EXEPAD_DATA_DIR || join(repoRoot, '.exepad-data'));
const storageRoot = join(dataDir, 'storage');

// Resolve the published config path (release dir) the same way the worker does.
const statusPath = join(storageRoot, appId, 'deployment-status-published.json');
const status = JSON.parse(readFileSync(statusPath, 'utf8'));
const configRel = status.configPath || 'published/app-config.json'; // e.g. published/releases/<id>/app-config.json
const publishedPrefix = configRel.endsWith('/app-config.json')
  ? configRel.slice(0, -'/app-config.json'.length)
  : 'published';

const config = JSON.parse(readFileSync(join(storageRoot, appId, configRel), 'utf8'));
const basePath = `/a/${appId}`;
const pagePath = slug === '/' ? basePath : `${basePath}${slug.startsWith('/') ? slug : `/${slug}`}`;

// First-fold components, in tree order: header → page content → footer. Only
// CodeComponentProps blocks that reference a repo component by name (those are
// what CodeComponent resolves through the registry).
const repoComponents = config.repo?.frontend?.components || {};
const page = (config.frontend?.pages || []).find((p) => p.slug === slug || p.slug === `/${slug.replace(/^\//, '')}`);
if (!page) {
  console.error(`[prerender] page slug "${slug}" not found in config`);
  process.exit(2);
}

function blockComponentName(b) {
  if (!b || b.componentType !== 'CodeComponentProps') return null;
  return typeof b.component === 'string' ? b.component
    : typeof b.componentName === 'string' ? b.componentName : null;
}

const orderedBlocks = [
  ...(Array.isArray(config.frontend?.header) ? config.frontend.header : []),
  ...(page.content || []),
  ...(Array.isArray(config.frontend?.footer) ? config.frontend.footer : []),
];

const components = [];
const seen = new Set();
for (const b of orderedBlocks) {
  const name = blockComponentName(b);
  if (!name || seen.has(name)) continue;
  const compiled = repoComponents[name]?.compiled;
  if (!compiled) continue;
  const file = join(storageRoot, appId, compiled);
  if (!existsSync(file)) {
    console.warn(`[prerender] compiled file missing for "${name}": ${file}`);
    continue;
  }
  seen.add(name);
  components.push({ name, file, url: `${basePath}/repo/${compiled}` });
}

console.error(`[prerender] ${appId} ${slug} → ${components.length} first-fold components: ${components.map((c) => c.name).join(', ')}`);

const { html, errors } = await renderAppPageToHtml({ repoRoot, appId, basePath, pagePath, config, components });

if (errors.length) {
  console.error(`[prerender] render reported ${errors.length} boundary error(s); first full stack:`);
  console.error(errors[0]);
}

// Write the artifact + a small sidecar manifest of the primed module URLs so the
// client can prime the exact same modules before hydrate.
const outKey = `${appId}/${publishedPrefix}/prerender/${slug === '/' ? 'index' : slug.replace(/^\//, '').replace(/\//g, '_')}.html`;
const outPath = join(storageRoot, outKey);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

const manifest = { basePath, modules: components.map((c) => c.url) };
writeFileSync(outPath.replace(/\.html$/, '.modules.json'), JSON.stringify(manifest), 'utf8');

console.error(`[prerender] wrote ${html.length} bytes → ${outKey}`);
console.error(`[prerender] hero present: ${/picsum\.photos|<img/i.test(html)}  suspense-markers: ${html.includes('<!--$-->') || html.includes('<!--$?-->')}`);
