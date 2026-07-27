// @vitest-environment jsdom
/**
 * Regression test for the per-app $persist hydration bug.
 *
 * Before the fix, the persist store auto-hydrated at module-import time (when
 * `_currentAppId` was still ''), reading the UNSCOPED `exepad-app-state` key.
 * All writes then landed in the scoped `exepad-app-state:<appId>` key, but the
 * next page load never read that scoped key back, so persisted state was lost
 * and overwritten with config initial values.
 *
 * The fix sets `skipHydration: true` and rehydrates AFTER setCurrentAppId (which
 * useRuntimeStore does). This test simulates a reload by resetting the module
 * registry (fresh store instance) while keeping localStorage, then rehydrating.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type StoreModule = typeof import('./appStateStore');

const APP_ID = 'test-app-abc123';

const CONFIG = {
  state: {
    counter: { $persist: true, initial: 0 },
    ephemeral: { $persist: false, initial: 'default' },
  },
} as const;

async function loadFreshStore(): Promise<StoreModule> {
  vi.resetModules();
  return import('./appStateStore');
}

describe('appStateStore $persist rehydration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rehydrates $persist keys from the scoped key after a simulated reload', async () => {
    // --- Session 1: fresh store, initialize, user modifies a persisted key ---
    const s1 = await loadFreshStore();
    s1.setCurrentAppId(APP_ID);
    s1.useAppStateStore.persist.rehydrate(); // nothing persisted yet
    s1.useAppStateStore.getState().initialize(CONFIG);
    s1.useAppStateStore.getState().set('counter', 42);

    // The persisted value must be written under the per-app scoped key.
    const scopedRaw = localStorage.getItem(`exepad-app-state:${APP_ID}`);
    expect(scopedRaw).toBeTruthy();
    expect(JSON.parse(scopedRaw as string).state._state.counter).toBe(42);
    // Non-persisted keys must NOT be written.
    expect(JSON.parse(scopedRaw as string).state._state.ephemeral).toBeUndefined();

    // --- Session 2: simulate a page reload (fresh module + store, same storage) ---
    const s2 = await loadFreshStore();
    // On import the store must NOT have auto-hydrated from the unscoped key.
    s2.setCurrentAppId(APP_ID);
    s2.useAppStateStore.persist.rehydrate();

    // The persisted user value survives the reload before initialize runs.
    expect(s2.useAppStateStore.getState()._state.counter).toBe(42);

    // Re-initializing from the same config must PRESERVE the persisted value,
    // not reset it back to the config initial (0).
    s2.useAppStateStore.getState().initialize(CONFIG);
    expect(s2.useAppStateStore.getState().get('counter')).toBe(42);
  });

  it('writes persisted state to the per-app scoped key, never the unscoped key', async () => {
    const s = await loadFreshStore();
    s.setCurrentAppId(APP_ID);
    s.useAppStateStore.persist.rehydrate();
    s.useAppStateStore.getState().initialize(CONFIG);
    s.useAppStateStore.getState().set('counter', 7);

    expect(localStorage.getItem(`exepad-app-state:${APP_ID}`)).toBeTruthy();
    // The unscoped legacy key must not be written for a scoped app.
    expect(localStorage.getItem('exepad-app-state')).toBeNull();
  });
});
