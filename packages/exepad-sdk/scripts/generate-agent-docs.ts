/**
 * generate-agent-docs.ts
 *
 * Parses packages/exepad-sdk/src/index.ts to extract all public exports
 * and generates:
 *   1. sdk-exports.json — machine-readable export catalog
 *   2. 05_CODE_COMPONENTS.md — agent reference doc (placed in packages/schemas/data/agent_docs/)
 *
 * Usage: npx tsx packages/exepad-sdk/scripts/generate-agent-docs.ts
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const REPO_ROOT = path.resolve(__dirname_local, '..', '..', '..');
const SDK_INDEX = path.join(REPO_ROOT, 'packages', 'exepad-sdk', 'src', 'index.ts');
const AGENT_DOCS_DIR = path.join(REPO_ROOT, 'packages', 'schemas', 'data', 'agent_docs');
const SDK_DIST_DIR = path.join(REPO_ROOT, 'packages', 'exepad-sdk', 'dist');

interface ExportEntry {
  name: string;
  kind: 'value' | 'type' | 'namespace';
  source: string; // relative module path
  category: string; // derived from comment or file path
}

// ---------------------------------------------------------------------------
// AST Parsing
// ---------------------------------------------------------------------------

function extractExports(filePath: string): ExportEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const entries: ExportEntry[] = [];
  let currentCategory = 'uncategorized';

  for (const stmt of sourceFile.statements) {
    // Track category from comments like "// --- Core ---"
    const fullText = stmt.getFullText(sourceFile);
    const commentMatch = fullText.match(/\/\/\s*---\s*(.+?)\s*---/);
    if (commentMatch) {
      currentCategory = commentMatch[1].trim();
    }

    if (ts.isExportDeclaration(stmt) && stmt.exportClause) {
      const modulePath = stmt.moduleSpecifier
        ? (stmt.moduleSpecifier as ts.StringLiteral).text
        : '';

      if (ts.isNamedExports(stmt.exportClause)) {
        for (const element of stmt.exportClause.elements) {
          const name = element.name.text;
          const isType = element.isTypeOnly || stmt.isTypeOnly;

          // Detect namespace exports (e.g., export { Charts } from './visuals' where Charts = export * as Charts)
          const kind: ExportEntry['kind'] = isType ? 'type' : 'value';
          entries.push({ name, kind, source: modulePath, category: currentCategory });
        }
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        // export * as Foo from '...'
        entries.push({
          name: stmt.exportClause.name.text,
          kind: 'namespace',
          source: modulePath,
          category: currentCategory,
        });
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Namespace detection heuristic
// ---------------------------------------------------------------------------

const KNOWN_NAMESPACES = new Set(['Charts', 'Icons', '_', 'Motion']);

function classifyExport(entry: ExportEntry): ExportEntry {
  if (KNOWN_NAMESPACES.has(entry.name)) {
    return { ...entry, kind: 'namespace' };
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Generate sdk-exports.json
// ---------------------------------------------------------------------------

interface SdkExportsJson {
  flat: string[];
  namespaces: Record<string, string[]>;
  types: string[];
  categories: Record<string, string[]>;
}

function buildSdkExportsJson(entries: ExportEntry[]): SdkExportsJson {
  const flat: string[] = [];
  const namespaces: Record<string, string[]> = {};
  const types: string[] = [];
  const categories: Record<string, string[]> = {};

  for (let entry of entries) {
    entry = classifyExport(entry);

    if (entry.kind === 'type') {
      types.push(entry.name);
    } else if (entry.kind === 'namespace') {
      // Known namespace members (curated)
      namespaces[entry.name] = getNamespaceMembers(entry.name);
    } else {
      flat.push(entry.name);
    }

    // Categorize
    if (!categories[entry.category]) {
      categories[entry.category] = [];
    }
    categories[entry.category].push(entry.name);
  }

  // Guard: a flat export and a namespace key sharing the same name would
  // silently dedupe in the agent's catalog (Python merges them via set
  // semantics in `load_sdk_exports()`), which masks intent and makes the
  // import auto-fixer unable to distinguish the two. Reject the build here
  // so the SDK author sees the conflict immediately instead of debugging a
  // weird agent-side message later.
  const flatSet = new Set(flat);
  const collisions = Object.keys(namespaces).filter((ns) => flatSet.has(ns));
  if (collisions.length > 0) {
    throw new Error(
      `[generate-agent-docs] Export name collision between flat and namespaces: ` +
        `${collisions.join(', ')}. Rename one or merge them into a single export ` +
        `kind so the agent's SDK catalog stays unambiguous.`,
    );
  }

  // Soft warning: a namespace MEMBER sharing a flat-export name (e.g.
  // ``Charts.Tooltip`` + flat ``Tooltip``) is benign because the access
  // path differs (``<Charts.Tooltip>`` vs ``<Tooltip>``), but it's worth
  // surfacing so renames are deliberate, not accidental.
  for (const [ns, members] of Object.entries(namespaces)) {
    const overlapping = members.filter((m) => flatSet.has(m));
    if (overlapping.length > 0) {
      console.warn(
        `⚠️  [generate-agent-docs] Namespace ${ns}.* members shadow flat ` +
          `exports: ${overlapping.join(', ')}. Access paths differ so the ` +
          `agent's import auto-fixer is fine, but the LLM may pick the wrong ` +
          `import path if both are documented.`,
      );
    }
  }

  return { flat, namespaces, types, categories };
}

function getNamespaceMembers(name: string): string[] {
  // Curated list of key members for agent documentation
  switch (name) {
    case 'Charts':
      return [
        'AreaChart', 'BarChart', 'LineChart', 'PieChart', 'RadarChart', 'RadialBarChart',
        'ComposedChart', 'ScatterChart', 'Treemap', 'Funnel',
        'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'Legend', 'ResponsiveContainer',
        'Area', 'Bar', 'Line', 'Pie', 'Cell', 'Radar', 'RadialBar',
      ];
    case 'Icons':
      return [
        '(All 1,912 lucide-react icons available as <Icons.PascalCaseName />. ' +
        'The most common ~559 render synchronously; others lazy-load on first ' +
        'use with a brief Circle fallback. Examples: Icons.Check, Icons.Briefcase, ' +
        'Icons.Gavel, Icons.Microscope, Icons.Stethoscope, Icons.Building2.)',
      ];
    case '_':
      return ['(lodash-es — full lodash library available as namespace)'];
    case 'Motion':
      return ['div', 'span', 'button', 'ul', 'li', 'nav', 'section', 'header', 'footer', 'main', 'article', 'aside', 'p', 'h1', 'h2', 'h3', 'img', 'a', 'form', 'input', 'svg', 'path'];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Generate 05_CODE_COMPONENTS.md
// ---------------------------------------------------------------------------

function buildAgentDoc(data: SdkExportsJson): string {
  const lines: string[] = [];

  lines.push('# Code Components — SDK Reference');
  lines.push('');
  lines.push('> Auto-generated from `packages/exepad-sdk/src/index.ts`. Do not edit manually.');
  lines.push('');

  // Import rules
  lines.push('## Import Rules');
  lines.push('');
  lines.push('1. **All imports MUST come from `@exepad/sdk`** — no npm packages, no relative imports. (Narrow exception: a 3D/WebGL game component may also import `@exepad/ext-three` / `@exepad/ext-pixi` — see the `game-3d` skill. No other package, and no Three.js subpaths/addons.)');
  lines.push('2. **Use `export default`** for the main component/handler/method.');
  lines.push('3. **Namespaces**: `Charts.BarChart`, `Icons.Check`, `Motion.div` — do NOT destructure.');
  lines.push('4. **Flat exports**: `Button`, `Card`, `useAppState` — import directly.');
  lines.push('');

  // Component template
  lines.push('## Component Template');
  lines.push('');
  lines.push('```tsx');
  lines.push('import { React, Button, Card, CardContent, Icons } from "@exepad/sdk";');
  lines.push('');
  lines.push('function MyComponent() {');
  lines.push('  return (');
  lines.push('    <Card>');
  lines.push('      <CardContent>');
  lines.push('        <Button><Icons.Check className="mr-2 h-4 w-4" /> Click me</Button>');
  lines.push('      </CardContent>');
  lines.push('    </Card>');
  lines.push('  );');
  lines.push('}');
  lines.push('');
  lines.push('export default MyComponent;');
  lines.push('```');
  lines.push('');

  // Available exports by category
  lines.push('## Available Exports');
  lines.push('');

  for (const [category, names] of Object.entries(data.categories)) {
    lines.push(`### ${category}`);
    lines.push('');
    lines.push('```');
    lines.push(names.join(', '));
    lines.push('```');
    lines.push('');
  }

  // Namespace details
  lines.push('## Namespaces');
  lines.push('');
  for (const [ns, members] of Object.entries(data.namespaces)) {
    lines.push(`### ${ns}`);
    lines.push('');
    if (members.length === 1 && members[0].startsWith('(')) {
      lines.push(members[0]);
    } else {
      lines.push('Key members: ' + members.join(', '));
    }
    lines.push('');
  }

  // Platform hooks section
  // NOTE: the hook destructure strings below are hand-authored, not derived
  // from the SDK types. They MUST be kept in sync with the return shapes in
  // packages/exepad-sdk/src/platform/types.ts (NavigationAPI, CurrentUser,
  // ThemeTokens) and the exported state hooks in
  // packages/exepad-sdk/src/index.ts (useApp, useAppState, useArrayState).
  lines.push('## Platform Hooks');
  lines.push('');
  lines.push('### useModel(name, opts?)');
  lines.push('Fetch data from a backend model with CRUD operations.');
  lines.push('```tsx');
  lines.push('const { data, loading, error, refetch, create, update, remove } = useModel("contacts", {');
  lines.push('  filters: { status: "active" },');
  lines.push('  orderBy: { createdAt: "desc" },');
  lines.push('  limit: 20,');
  lines.push('});');
  lines.push('```');
  lines.push('');
  lines.push('### useHandler(name, opts?)');
  lines.push('Call a backend handler and get its result.');
  lines.push('```tsx');
  lines.push('const { data, loading, error, execute, refetch } = useHandler("getStats");');
  lines.push('// Imperative call:');
  lines.push('const result = await execute({ startDate: "2024-01-01" });');
  lines.push('```');
  lines.push('');
  lines.push('### useNavigation()');
  lines.push('Navigate between pages programmatically.');
  lines.push('```tsx');
  lines.push('const { navigate, currentPath, currentSlug, basePath } = useNavigation();');
  lines.push('navigate("/about");');
  lines.push('```');
  lines.push('');
  lines.push('### useTheme()');
  lines.push('Access the app theme tokens (colors, typography, borderRadius).');
  lines.push('```tsx');
  lines.push('const { colors, typography, borderRadius, mode } = useTheme();');
  lines.push('```');
  lines.push('');
  lines.push('### useCurrentUser()');
  lines.push('Access the current authenticated user.');
  lines.push('```tsx');
  lines.push('const { id, email, name, roles, isAuthenticated } = useCurrentUser();');
  lines.push('```');
  lines.push('');

  // State management hooks
  lines.push('## State Management');
  lines.push('');
  lines.push('### useAppState(key, initialValue?)');
  lines.push('Read/write a single state value.');
  lines.push('```tsx');
  lines.push('const [count, setCount, updateCount] = useAppState("count", 0);');
  lines.push('```');
  lines.push('');
  lines.push('### useArrayState(key, initialValue?)');
  lines.push('Manage array state with push/remove/updateItem/clear helpers.');
  lines.push('```tsx');
  lines.push('const { items, push, remove, updateItem, clear, set } = useArrayState("todos");');
  lines.push('```');
  lines.push('');
  lines.push('### useApp(selector?)');
  lines.push('Select from the app state store; pass a selector to re-render only when the selected values change.');
  lines.push('```tsx');
  lines.push('const count = useApp(s => s.count);        // narrowed selection (recommended)');
  lines.push('const setState = useApp(s => s.setState);');
  lines.push('const { count, setState } = useApp();       // whole snapshot — re-renders on any change; use sparingly (the validator auto-rewrites this to per-key selectors)');
  lines.push('```');
  lines.push('');

  // Helpers
  lines.push('## Helpers');
  lines.push('');
  lines.push('- `cn(...classes)` — Tailwind class merging utility (clsx + tailwind-merge)');
  lines.push('- `toast(message, opts?)` — Show toast notifications (from sonner)');
  lines.push('- `navigate(path, opts?)` — Standalone navigation function (non-hook)');
  lines.push('');

  // Anti-patterns
  lines.push('## Common Mistakes');
  lines.push('');
  lines.push('```tsx');
  lines.push('// ❌ BAD: Direct npm import');
  lines.push('import { BarChart } from "recharts";');
  lines.push('');
  lines.push('// ✅ GOOD: Use SDK namespace');
  lines.push('import { Charts } from "@exepad/sdk";');
  lines.push('// Then: <Charts.BarChart />');
  lines.push('');
  lines.push('// ❌ BAD: Destructure namespace');
  lines.push('const { BarChart } = Charts;');
  lines.push('');
  lines.push('// ✅ GOOD: Use namespace directly');
  lines.push('<Charts.BarChart data={data}>...</Charts.BarChart>');
  lines.push('');
  lines.push('// ❌ BAD: Import React from react');
  lines.push('import React from "react";');
  lines.push('');
  lines.push('// ✅ GOOD: Import React from SDK');
  lines.push('import { React } from "@exepad/sdk";');
  lines.push('');
  lines.push('// ❌ BAD: passing a TYPE as the generic — TS error');
  lines.push('//   "Type X does not satisfy the constraint keyof AppHandlerOutputs"');
  lines.push('const { data } = useHandler<SearchOutput>("getJobSearch");');
  lines.push('const { data } = useModel<Company>("companies");');
  lines.push('');
  lines.push('// ✅ GOOD: pass only the string name; output type is inferred');
  lines.push('//   from AppHandlerOutputs / AppModels (the generic K is the NAME, not the output)');
  lines.push('const { data } = useHandler("getJobSearch");');
  lines.push('const { data } = useModel("companies");');
  lines.push('// If you must annotate, the generic is the NAME literal:');
  lines.push("//   useHandler<'getJobSearch'>(\"getJobSearch\")");
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(SDK_INDEX)) {
    console.error(`SDK index not found: ${SDK_INDEX}`);
    process.exit(1);
  }

  const entries = extractExports(SDK_INDEX);
  const data = buildSdkExportsJson(entries);

  // Ensure output directories exist
  fs.mkdirSync(SDK_DIST_DIR, { recursive: true });
  fs.mkdirSync(AGENT_DOCS_DIR, { recursive: true });

  // Write sdk-exports.json
  const exportsPath = path.join(SDK_DIST_DIR, 'sdk-exports.json');
  fs.writeFileSync(exportsPath, JSON.stringify(data, null, 2));
  console.log(`✅ sdk-exports.json written (${data.flat.length} flat, ${Object.keys(data.namespaces).length} namespaces, ${data.types.length} types)`);

  // Write 05_CODE_COMPONENTS.md
  const agentDocPath = path.join(AGENT_DOCS_DIR, '05_CODE_COMPONENTS.md');
  const doc = buildAgentDoc(data);
  fs.writeFileSync(agentDocPath, doc);
  console.log(`✅ 05_CODE_COMPONENTS.md written (${doc.split('\n').length} lines)`);
}

main();
