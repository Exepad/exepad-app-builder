import { describe, it, expect } from 'vitest';

import * as barrel from '../index';
import * as coreEntry from './core';
import * as chartsEntry from './charts';
import * as motionEntry from './motion';
import * as formsEntry from './forms';
import * as overlaysEntry from './overlays';
import * as iconsEntry from './icons';

/**
 * Regression guard for the lazy-loadable, per-entry SDK split.
 *
 * The SDK ships a single `@exepad/sdk` barrel (byte-frozen import-map target)
 * PLUS additive `@exepad/sdk/{core,charts,motion,forms,overlays,icons}` subpath
 * entries. The agent rewrites a generated component's bare-barrel import into
 * subpath imports so a core-only page never parses the ~1.7MB monolith
 * (recharts/framer-motion/cmdk/vaul/embla/react-day-picker/lucide).
 *
 * `scripts/check-split-chunks.mjs` guards the *built* chunks (engine isolation +
 * sizes), but it needs a full `vite build`. This unit test guards the same
 * invariants at the *source* level in the fast `test` job by actually importing
 * and evaluating every entry module:
 *   1. every subpath entry loads without throwing and exposes its headline API;
 *   2. the barrel stays a superset of the split (never drops a symbol);
 *   3. `/core` stays lean (no heavy namespaces/widgets leak into it);
 *   4. every runtime export of the barrel is routed to EXACTLY ONE subpath —
 *      the exact contract the agent's import-splitter depends on.
 */

// Subpath specifier -> the loaded entry module namespace. Order mirrors
// gen-subpaths.mjs (core is the catch-all default).
const SUBPATHS: Record<string, Record<string, unknown>> = {
  '@exepad/sdk/core': coreEntry,
  '@exepad/sdk/charts': chartsEntry,
  '@exepad/sdk/motion': motionEntry,
  '@exepad/sdk/forms': formsEntry,
  '@exepad/sdk/overlays': overlaysEntry,
  '@exepad/sdk/icons': iconsEntry,
};

// Runtime (value) export names — a namespace object only carries values, so its
// own enumerable keys minus the synthetic `default` are the runtime surface.
const runtimeExports = (mod: Record<string, unknown>): string[] =>
  Object.keys(mod).filter((k) => k !== 'default');

describe('SDK split entries — every subpath loads and exposes its headline API', () => {
  it('core exposes the React namespace + platform hooks', () => {
    expect(coreEntry.React).toBeDefined();
    expect(typeof coreEntry.useModel).toBe('function');
    expect(typeof coreEntry.useApp).toBe('function');
  });

  it('charts exposes the recharts namespace + chart wrappers', () => {
    expect(chartsEntry.Charts).toBeDefined();
    expect((chartsEntry.Charts as Record<string, unknown>).ResponsiveContainer).toBeDefined();
    expect(chartsEntry.ChartContainer).toBeDefined();
  });

  it('motion exposes the framer-motion proxy + presets', () => {
    expect(motionEntry.motion).toBeDefined();
    expect(motionEntry.Motion).toBe(motionEntry.motion);
    expect(motionEntry.FadeIn).toBeDefined();
  });

  it('forms exposes the heavy-dep widgets', () => {
    expect(formsEntry.Calendar).toBeDefined();
    expect(formsEntry.Command).toBeDefined();
    expect(formsEntry.Drawer).toBeDefined();
  });

  it('overlays exposes the Radix portal surfaces', () => {
    expect(overlaysEntry.Dialog).toBeDefined();
    expect(overlaysEntry.Popover).toBeDefined();
    expect(overlaysEntry.DropdownMenu).toBeDefined();
  });

  it('icons exposes the curated lucide namespace', () => {
    expect(iconsEntry.Icons).toBeDefined();
    expect(Object.keys(iconsEntry.Icons as object).length).toBeGreaterThan(0);
  });
});

describe('SDK barrel stays fully functional (superset of the split)', () => {
  it('re-exports the heavy namespaces so the monolith import keeps working', () => {
    expect(barrel.Charts).toBeDefined();
    expect(barrel.Icons).toBeDefined();
    expect(barrel.motion).toBeDefined();
    expect(barrel.Motion).toBeDefined();
  });

  it('re-exports at least one representative widget from every heavy subpath', () => {
    expect(barrel.ChartContainer).toBeDefined(); // charts
    expect(barrel.FadeIn).toBeDefined(); // motion
    expect(barrel.Calendar).toBeDefined(); // forms
    expect(barrel.Dialog).toBeDefined(); // overlays
  });

  it('contains every runtime export that the split entries expose', () => {
    const barrelKeys = new Set(runtimeExports(barrel));
    const droppedBySplit: string[] = [];
    for (const [sp, mod] of Object.entries(SUBPATHS)) {
      for (const name of runtimeExports(mod)) {
        if (!barrelKeys.has(name)) droppedBySplit.push(`${name} (${sp})`);
      }
    }
    expect(droppedBySplit).toEqual([]);
  });
});

describe('SDK /core stays lean (heavy surfaces are isolated out)', () => {
  it('does not carry the heavy namespaces', () => {
    const coreKeys = new Set(runtimeExports(coreEntry));
    for (const heavy of ['Charts', 'Icons', 'motion', 'Motion']) {
      expect(coreKeys.has(heavy)).toBe(false);
    }
  });

  it('does not carry the heavy widgets routed to charts/motion/forms/overlays', () => {
    const coreKeys = new Set(runtimeExports(coreEntry));
    for (const heavy of ['ChartContainer', 'FadeIn', 'Calendar', 'Command', 'Drawer', 'Dialog']) {
      expect(coreKeys.has(heavy)).toBe(false);
    }
  });
});

describe('import routing table — every barrel export is served by exactly one subpath', () => {
  it('routes each runtime barrel symbol to a single subpath (no gaps, no dups)', () => {
    const owners: Record<string, string[]> = {};
    for (const [sp, mod] of Object.entries(SUBPATHS)) {
      for (const name of runtimeExports(mod)) {
        (owners[name] ??= []).push(sp);
      }
    }

    const unrouted: string[] = [];
    const duplicated: string[] = [];
    for (const name of runtimeExports(barrel)) {
      const where = owners[name] ?? [];
      if (where.length === 0) unrouted.push(name);
      else if (where.length > 1) duplicated.push(`${name} (${where.join(', ')})`);
    }

    expect({ unrouted, duplicated }).toEqual({ unrouted: [], duplicated: [] });
  });
});
