/**
 * Test helpers for the local-SQLite deploy backend.
 *
 * The deploy pipeline now executes against real `better-sqlite3` files under
 * `$EXEPAD_DATA_DIR/apps/{appId}/{mode}.sqlite` instead of the Cloudflare D1
 * REST API. These helpers point `EXEPAD_DATA_DIR` at a throwaway temp dir per
 * test so every run gets isolated, real databases + storage.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeploymentConfig } from '../../src/deploy/types';

/** Standard test deployment config (CF fields are vestigial / ignored locally). */
export const TEST_CONFIG: DeploymentConfig = {
  appId: 'testapp01',
  appAlias: 'test',
  accountId: 'local',
  apiToken: 'local',
  wfpNamespace: 'local',
};

/** A config for a specific app id (+ optional mode). */
export function configFor(appId: string, mode?: 'preview' | 'published'): DeploymentConfig {
  return { ...TEST_CONFIG, appId, ...(mode ? { mode } : {}) };
}

let activeDir: string | null = null;

/**
 * Point `EXEPAD_DATA_DIR` at a fresh temp dir. Call in `beforeEach`; pair with
 * {@link teardownDataDir} in `afterEach`. Returns the temp dir path.
 */
export function setupDataDir(): string {
  activeDir = mkdtempSync(join(tmpdir(), 'exepad-deploy-'));
  process.env.EXEPAD_DATA_DIR = activeDir;
  return activeDir;
}

/** Remove the temp dir and unset `EXEPAD_DATA_DIR`. Call in `afterEach`. */
export function teardownDataDir(): void {
  if (activeDir) {
    rmSync(activeDir, { recursive: true, force: true });
    activeDir = null;
  }
  delete process.env.EXEPAD_DATA_DIR;
}
