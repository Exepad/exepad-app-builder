/**
 * Static Seed Resolver
 *
 * Resolves seed data entries that target static datasets (no matching D1 model).
 * Reads CSV/JSON files from R2, parses records, and injects them inline into
 * appConfig.backend.data.datasets as StaticDatasetProps objects (static mode).
 *
 * This runs at deploy time, before the config is written to the published
 * snapshot — ensuring the browser-served config contains the inline records.
 *
 * Routing rule: if a seed entry's `model` name is NOT in `backendModelNames`,
 * it's a static dataset. Otherwise it's handled by seedFromR2() → D1.
 */

import type { SeedRepoProps } from '@exepad/types';
import { parseCSVString, parseJSONString } from './r2-seeder';

export interface ResolveStaticSeedsOptions {
  r2: R2Bucket;
  appId: string;
  appConfig: Record<string, any>;
  seedEntries: Record<string, SeedRepoProps>;
  /** Model names should already be lowercased by the caller */
  backendModelNames: Set<string>;
}

export interface ResolveStaticSeedsResult {
  /** Dataset names that were resolved as static */
  resolved: string[];
  /** Non-fatal errors */
  errors: string[];
}

/**
 * Resolve static seed entries by reading CSV/JSON from R2 and inlining
 * records into `appConfig.backend.data.datasets` (static mode).
 *
 * Mutates `appConfig` in place.
 */
export async function resolveStaticSeeds(
  options: ResolveStaticSeedsOptions
): Promise<ResolveStaticSeedsResult> {
  const { r2, appId, appConfig, seedEntries, backendModelNames } = options;
  const result: ResolveStaticSeedsResult = { resolved: [], errors: [] };

  for (const [entryName, entry] of Object.entries(seedEntries)) {
    // Skip D1-targeted entries — those are handled by seedFromR2()
    if (backendModelNames.has(entry.model.toLowerCase())) {
      continue;
    }

    try {
      // Read seed file from R2
      const r2Key = `${appId}/${entry.source}`;
      const object = await r2.get(r2Key);
      if (!object) {
        result.errors.push(`[${entryName}] Seed file not found in R2: ${r2Key}`);
        continue;
      }
      const content = await object.text();

      // Parse based on format
      let records: Record<string, unknown>[];

      if (entry.format === 'csv') {
        const parsed = parseCSVString(content);
        records = parsed.records;
      } else {
        const parsed = parseJSONString(content, entry.model);
        if (parsed.error) {
          result.errors.push(`[${entryName}] ${parsed.error}`);
          continue;
        }
        records = parsed.records;
      }

      if (records.length === 0) {
        result.errors.push(`[${entryName}] No records parsed from seed file`);
        continue;
      }

      // Cannot inject static datasets into dynamic-mode backend
      if (appConfig.backend?.mode === 'dynamic') {
        result.errors.push(`[${entryName}] Cannot inject static dataset '${entry.model}' into dynamic-mode backend`);
        continue;
      }

      // Ensure backend.data.datasets path exists (static mode)
      if (!appConfig.backend) appConfig.backend = { mode: 'static', data: { datasets: {} } };
      if (!appConfig.backend.data) appConfig.backend.data = { datasets: {} };
      if (!appConfig.backend.data.datasets) appConfig.backend.data.datasets = {};

      // Inject as StaticDatasetProps
      appConfig.backend.data.datasets[entry.model] = {
        type: 'static',
        records,
        generated: true,
        _meta: {
          totalCount: records.length,
          truncated: false,
          sourceHint: `Resolved from ${entry.source}`,
        },
      };

      result.resolved.push(entry.model);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`[${entryName}] Unexpected error: ${msg}`);
    }
  }

  return result;
}
