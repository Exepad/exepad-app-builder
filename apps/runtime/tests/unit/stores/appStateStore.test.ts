/**
 * AppStateStore Tests
 * Tests for the unified runtime state store: smart-merge on initialize(),
 * dot-notation get/set, partialize persistence filtering, and per-app
 * localStorage scoping + legacy migration.
 *
 * The store uses Zustand's `persist` middleware whose storage adapter reads
 * the module-level `_currentAppId` at access time. happy-dom supplies a real
 * `localStorage`, so we drive the store and then assert on what actually
 * landed in storage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useAppStateStore,
  setCurrentAppId,
  type AppConfig,
} from '@/stores/appStateStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERSIST_KEY = 'exepad-app-state';

/** Read + parse the persisted blob for a given (optional) app scope. */
function readPersisted(appId?: string): any {
  const key = appId ? `${PERSIST_KEY}:${appId}` : PERSIST_KEY;
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

/** Fully reset store + storage scope + localStorage between tests. */
function freshStore(): void {
  // Reset the per-app scope to the global (unscoped) key.
  setCurrentAppId('');
  // reset() clears _state, _initialized, _persistKeys and _userModifiedKeys.
  // It also triggers a persist flush; clear storage AFTER so no stray write
  // (e.g. the empty reset blob) survives into the next test's scope.
  useAppStateStore.getState().reset();
  localStorage.clear();
}

beforeEach(() => {
  freshStore();
});

afterEach(() => {
  freshStore();
});

// ─── initialize(): persist-flag detection ──────────────────────────────────────

describe('AppStateStore — initialize() persist-flag detection', () => {
  it('extracts the `initial` value from a $persist config entry', () => {
    const config: AppConfig = {
      state: {
        // $persist wrapper: store the initial value, register the key as persistable
        theme: { $persist: true, initial: 'dark' },
        // plain value: stored verbatim
        count: 0,
      },
    };

    useAppStateStore.getState().initialize(config);

    expect(useAppStateStore.getState().get('theme')).toBe('dark');
    expect(useAppStateStore.getState().get('count')).toBe(0);
    expect(useAppStateStore.getState()._persistKeys.has('theme')).toBe(true);
    expect(useAppStateStore.getState()._persistKeys.has('count')).toBe(false);
  });

  it('does NOT register a key whose $persist is falsy', () => {
    const config: AppConfig = {
      state: {
        scratch: { $persist: false, initial: 42 },
      },
    };

    useAppStateStore.getState().initialize(config);

    expect(useAppStateStore.getState().get('scratch')).toBe(42);
    expect(useAppStateStore.getState()._persistKeys.has('scratch')).toBe(false);
  });

  it('treats arrays and null as plain values, not $persist wrappers', () => {
    const config: AppConfig = {
      state: {
        // Array that happens to be checked for '$persist in' must not be misread
        items: [1, 2, 3],
        nothing: null,
      },
    };

    useAppStateStore.getState().initialize(config);

    expect(useAppStateStore.getState().get('items')).toEqual([1, 2, 3]);
    expect(useAppStateStore.getState().get('nothing')).toBeNull();
    expect(useAppStateStore.getState()._persistKeys.size).toBe(0);
  });

  it('handles a missing/empty `state` config without throwing', () => {
    useAppStateStore.getState().initialize({});
    expect(useAppStateStore.getState().isInitialized()).toBe(true);
    expect(useAppStateStore.getState()._persistKeys.size).toBe(0);
  });

  it('sets router and basePath from initialize args', () => {
    const router = { push: () => {}, replace: () => {} };
    useAppStateStore.getState().initialize({ state: {} }, router, '/a/my-app');

    expect(useAppStateStore.getState()._router).toBe(router);
    expect(useAppStateStore.getState()._basePath).toBe('/a/my-app');
  });
});

// ─── initialize(): smart-merge — rehydration vs HMR ─────────────────────────────

describe('AppStateStore — initialize() smart-merge', () => {
  it('fresh init (not initialized) takes config values verbatim', () => {
    const config: AppConfig = { state: { count: 5, label: 'hi' } };
    useAppStateStore.getState().initialize(config);

    expect(useAppStateStore.getState().get('count')).toBe(5);
    expect(useAppStateStore.getState().get('label')).toBe('hi');
  });

  it('rehydration (initialized, no user-modified keys) preserves ALL existing values over config', () => {
    // Simulate a page reload: the persist middleware restored _state and
    // _initialized=true, but _userModifiedKeys is empty (never persisted).
    useAppStateStore.setState({
      _state: { count: 99, label: 'persisted' },
      _initialized: true,
      _userModifiedKeys: new Set<string>(),
    });

    // New config arrives with different defaults — they must NOT clobber the
    // user's previous-session values.
    useAppStateStore.getState().initialize({ state: { count: 0, label: 'default' } });

    expect(useAppStateStore.getState().get('count')).toBe(99);
    expect(useAppStateStore.getState().get('label')).toBe('persisted');
  });

  it('rehydration applies config value for keys NOT present in existing state', () => {
    useAppStateStore.setState({
      _state: { count: 99 },
      _initialized: true,
      _userModifiedKeys: new Set<string>(),
    });

    // `newKey` is not in existing state → config value wins.
    useAppStateStore.getState().initialize({ state: { count: 0, newKey: 'added' } });

    expect(useAppStateStore.getState().get('count')).toBe(99);
    expect(useAppStateStore.getState().get('newKey')).toBe('added');
  });

  it('re-init / HMR preserves ONLY user-modified keys, refreshing the rest from config', () => {
    // Initialize, then the user modifies one key during the session.
    useAppStateStore.getState().initialize({ state: { count: 0, label: 'old' } });
    useAppStateStore.getState().set('count', 7); // marks `count` user-modified

    // HMR/config push: a new config arrives with updated defaults.
    useAppStateStore.getState().initialize({ state: { count: 0, label: 'new-from-config' } });

    // User-modified `count` is preserved; un-touched `label` is refreshed.
    expect(useAppStateStore.getState().get('count')).toBe(7);
    expect(useAppStateStore.getState().get('label')).toBe('new-from-config');
  });

  it('re-init keeps user-modified keys that are absent from the new config (dynamic runtime keys)', () => {
    useAppStateStore.getState().initialize({ state: { count: 0 } });
    useAppStateStore.getState().set('runtimeOnly', 'live'); // not in any config

    useAppStateStore.getState().initialize({ state: { count: 0 } });

    expect(useAppStateStore.getState().get('runtimeOnly')).toBe('live');
  });

  it('preserves _scaffold_-prefixed runtime state across re-init even when not user-modified', () => {
    useAppStateStore.getState().initialize({ state: { count: 0 } });
    // Force the re-init (HMR) path rather than rehydration by recording a
    // user modification, so config values refresh for un-touched keys.
    useAppStateStore.getState().set('count', 0); // marks `count` user-modified
    // Inject scaffold state directly (as the scaffold layer would, not via set()).
    useAppStateStore.setState((s) => ({
      _state: { ...s._state, _scaffold_nav: { open: true } },
    }));

    useAppStateStore.getState().initialize({ state: { count: 1, other: 'fresh' } });

    // Scaffold state survives even though it was never user-modified.
    expect(useAppStateStore.getState().get('_scaffold_nav')).toEqual({ open: true });
    // Un-touched config key refreshes under the HMR path.
    expect(useAppStateStore.getState().get('other')).toBe('fresh');
  });
});

// ─── initialize(): auth key special-casing ──────────────────────────────────────

describe('AppStateStore — initialize() auth special-casing', () => {
  it('always takes the fresh config value for `auth`, never the persisted one (rehydration)', () => {
    // Stale persisted auth from a previous session.
    useAppStateStore.setState({
      _state: { auth: { user: 'stale', loggedIn: true } },
      _initialized: true,
      _userModifiedKeys: new Set<string>(),
    });

    // Live session check produced a fresh (logged-out) auth default.
    useAppStateStore
      .getState()
      .initialize({ state: { auth: { user: null, loggedIn: false } } });

    // Auth must reflect the live config, NOT the stale persisted value.
    expect(useAppStateStore.getState().get('auth')).toEqual({
      user: null,
      loggedIn: false,
    });
  });

  it('takes the fresh config value for `auth` even when user-modified (re-init)', () => {
    useAppStateStore.getState().initialize({ state: { auth: { loggedIn: false } } });
    // Even if something marked auth as modified, the live config must win.
    useAppStateStore.getState().set('auth', { loggedIn: true, user: 'transient' });

    useAppStateStore.getState().initialize({ state: { auth: { loggedIn: false } } });

    expect(useAppStateStore.getState().get('auth')).toEqual({ loggedIn: false });
  });
});

// ─── get()/set(): dot-notation + array preservation ─────────────────────────────

describe('AppStateStore — dot-notation get/set', () => {
  beforeEach(() => {
    useAppStateStore.getState().initialize({ state: {} });
  });

  it('gets a top-level key', () => {
    useAppStateStore.getState().set('x', 1);
    expect(useAppStateStore.getState().get('x')).toBe(1);
  });

  it('gets nested values via dot notation', () => {
    useAppStateStore.getState().set('form', { user: { name: 'Ada' } });
    expect(useAppStateStore.getState().get('form.user.name')).toBe('Ada');
  });

  it('returns undefined when a dot-path segment is missing (no throw)', () => {
    useAppStateStore.getState().set('form', { user: null });
    expect(useAppStateStore.getState().get('form.user.name')).toBeUndefined();
    expect(useAppStateStore.getState().get('absent.deeply.nested')).toBeUndefined();
  });

  it('sets a nested value, creating intermediate objects', () => {
    useAppStateStore.getState().set('a.b.c', 'deep');
    expect(useAppStateStore.getState().get('a.b.c')).toBe('deep');
    expect(useAppStateStore.getState().get('a')).toEqual({ b: { c: 'deep' } });
  });

  it('preserves sibling keys when setting a nested value', () => {
    useAppStateStore.getState().set('obj', { keep: 1, nested: { a: 1 } });
    useAppStateStore.getState().set('obj.nested.b', 2);

    expect(useAppStateStore.getState().get('obj')).toEqual({
      keep: 1,
      nested: { a: 1, b: 2 },
    });
  });

  it('preserves arrays along a dot-path instead of turning them into objects', () => {
    // The set() impl clones arrays with [...] not {...}; mutating a deeper path
    // that traverses an array index must keep it an array.
    useAppStateStore.getState().set('list', [{ done: false }, { done: false }]);
    useAppStateStore.getState().set('list.0.done', true);

    const list = useAppStateStore.getState().get<any[]>('list');
    expect(Array.isArray(list)).toBe(true);
    expect(list).toEqual([{ done: true }, { done: false }]);
  });

  it('immutably replaces state — old reference is not mutated', () => {
    useAppStateStore.getState().set('obj', { a: 1 });
    const before = useAppStateStore.getState().get('obj');
    useAppStateStore.getState().set('obj.a', 2);
    const after = useAppStateStore.getState().get('obj');

    expect(before).not.toBe(after);
    expect(before).toEqual({ a: 1 });
    expect(after).toEqual({ a: 2 });
  });

  it('tracks the root key as user-modified on a dotted set', () => {
    useAppStateStore.getState().set('deep.nested.value', 1);
    expect(useAppStateStore.getState()._userModifiedKeys.has('deep')).toBe(true);
  });
});

// ─── Array helpers ──────────────────────────────────────────────────────────────

describe('AppStateStore — array helpers', () => {
  beforeEach(() => {
    useAppStateStore.getState().initialize({ state: {} });
  });

  it('push() appends to a (possibly undefined) array', () => {
    useAppStateStore.getState().push('todos', 'a');
    useAppStateStore.getState().push('todos', 'b');
    expect(useAppStateStore.getState().get('todos')).toEqual(['a', 'b']);
  });

  it('remove() by index drops the right element', () => {
    useAppStateStore.getState().set('xs', ['a', 'b', 'c']);
    useAppStateStore.getState().remove('xs', 1);
    expect(useAppStateStore.getState().get('xs')).toEqual(['a', 'c']);
  });

  it('remove() by predicate filters matching elements', () => {
    useAppStateStore.getState().set('xs', [1, 2, 3, 4]);
    useAppStateStore.getState().remove('xs', (n) => (n as number) % 2 === 0);
    expect(useAppStateStore.getState().get('xs')).toEqual([1, 3]);
  });

  it('updateItem() merges object updates at a matching index', () => {
    useAppStateStore.getState().set('rows', [{ id: 1, v: 'a' }, { id: 2, v: 'b' }]);
    useAppStateStore.getState().updateItem('rows', 1, { v: 'B' });
    expect(useAppStateStore.getState().get('rows')).toEqual([
      { id: 1, v: 'a' },
      { id: 2, v: 'B' },
    ]);
  });

  it('updateItem() with predicate replaces non-object items wholesale', () => {
    useAppStateStore.getState().set('xs', [1, 2, 3]);
    useAppStateStore.getState().updateItem('xs', (n) => n === 2, 20);
    expect(useAppStateStore.getState().get('xs')).toEqual([1, 20, 3]);
  });

  it('clear() empties an array', () => {
    useAppStateStore.getState().set('xs', [1, 2, 3]);
    useAppStateStore.getState().clear('xs');
    expect(useAppStateStore.getState().get('xs')).toEqual([]);
  });

  it('update() applies a functional updater', () => {
    useAppStateStore.getState().set('n', 1);
    useAppStateStore.getState().update<number>('n', (prev) => prev + 41);
    expect(useAppStateStore.getState().get('n')).toBe(42);
  });
});

// ─── partialize: NEVER persists auth ────────────────────────────────────────────

describe('AppStateStore — partialize persistence filtering', () => {
  it('NEVER persists the `auth` key to localStorage (explicit $persist defined)', () => {
    useAppStateStore.getState().initialize({
      state: {
        token: { $persist: true, initial: 'abc' },
        auth: { loggedIn: false },
      },
    });
    // Modify both so a write is flushed.
    useAppStateStore.getState().set('token', 'xyz');
    useAppStateStore.getState().set('auth', { loggedIn: true, user: 'eve' });

    const persisted = readPersisted();
    expect(persisted).not.toBeNull();
    expect(persisted.state._state).toHaveProperty('token', 'xyz');
    // SECURITY: auth must never be written to storage, even when modified.
    expect(persisted.state._state).not.toHaveProperty('auth');
  });

  it('NEVER persists `auth` even under the legacy-heuristic path (no $persist keys)', () => {
    // No $persist config → falls through to naming heuristics, but auth is
    // filtered first regardless.
    useAppStateStore.getState().initialize({ state: { auth: { loggedIn: false }, foo: 1 } });
    useAppStateStore.getState().set('auth', { loggedIn: true });
    useAppStateStore.getState().set('foo', 2);

    const persisted = readPersisted();
    expect(persisted.state._state).not.toHaveProperty('auth');
    expect(persisted.state._state).toHaveProperty('foo', 2);
  });

  it('persists ONLY $persist keys when any are defined (exclusive allow-list)', () => {
    useAppStateStore.getState().initialize({
      state: {
        keepMe: { $persist: true, initial: 1 },
        dropMe: { $persist: false, initial: 2 },
        alsoDrop: 3,
      },
    });
    useAppStateStore.getState().set('keepMe', 10);
    useAppStateStore.getState().set('dropMe', 20);
    useAppStateStore.getState().set('alsoDrop', 30);

    const stored = readPersisted().state._state;
    expect(stored).toHaveProperty('keepMe', 10);
    expect(stored).not.toHaveProperty('dropMe');
    expect(stored).not.toHaveProperty('alsoDrop');
  });

  it('applies legacy naming heuristics when NO $persist keys are configured', () => {
    // Heuristic drops: show*, *Modal*, *Confirm*, editing*, selected*,
    // isLoading*, *Loading. Everything else persists.
    useAppStateStore.getState().initialize({ state: {} });
    useAppStateStore.getState().set('showSidebar', true);
    useAppStateStore.getState().set('deleteModal', { open: true });
    useAppStateStore.getState().set('needsConfirm', true);
    useAppStateStore.getState().set('editingId', 5);
    useAppStateStore.getState().set('selectedRow', 2);
    useAppStateStore.getState().set('isLoadingData', true);
    useAppStateStore.getState().set('usersLoading', true);
    useAppStateStore.getState().set('username', 'persist-me');

    const stored = readPersisted().state._state;
    expect(stored).not.toHaveProperty('showSidebar');
    expect(stored).not.toHaveProperty('deleteModal');
    expect(stored).not.toHaveProperty('needsConfirm');
    expect(stored).not.toHaveProperty('editingId');
    expect(stored).not.toHaveProperty('selectedRow');
    expect(stored).not.toHaveProperty('isLoadingData');
    expect(stored).not.toHaveProperty('usersLoading');
    // Only the durable key survives.
    expect(stored).toHaveProperty('username', 'persist-me');
  });

  it('persists the _initialized flag alongside filtered state', () => {
    useAppStateStore.getState().initialize({ state: { keep: { $persist: true, initial: 1 } } });
    useAppStateStore.getState().set('keep', 2);

    expect(readPersisted().state._initialized).toBe(true);
  });
});

// ─── Per-app localStorage scoping ───────────────────────────────────────────────

describe('AppStateStore — per-app localStorage scoping', () => {
  it('writes to the unscoped key when no app id is set', () => {
    setCurrentAppId('');
    useAppStateStore.getState().initialize({ state: { v: { $persist: true, initial: 1 } } });
    useAppStateStore.getState().set('v', 2);

    expect(localStorage.getItem(PERSIST_KEY)).not.toBeNull();
    expect(localStorage.getItem(`${PERSIST_KEY}:`)).toBeNull();
  });

  it('writes to a per-app scoped key (`exepad-app-state:<appId>`) when an app id is set', () => {
    setCurrentAppId('app-123');
    useAppStateStore.getState().initialize({ state: { v: { $persist: true, initial: 1 } } });
    useAppStateStore.getState().set('v', 7);

    expect(readPersisted('app-123')).not.toBeNull();
    expect(readPersisted('app-123').state._state).toHaveProperty('v', 7);
    // The unscoped global key must NOT be written.
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull();
  });

  it('isolates state between two different app ids', () => {
    // App A — write then capture its scoped blob before tearing down the store
    // (reset() flushes an empty blob to the *current* scope, so snapshot first).
    setCurrentAppId('app-A');
    useAppStateStore.getState().initialize({ state: { color: { $persist: true, initial: 'red' } } });
    useAppStateStore.getState().set('color', 'red');
    const appAColor = readPersisted('app-A').state._state.color;

    // App B — switch scope (without disturbing app-A's already-written key).
    setCurrentAppId('app-B');
    useAppStateStore.getState().reset();
    useAppStateStore.getState().initialize({ state: { color: { $persist: true, initial: 'blue' } } });
    useAppStateStore.getState().set('color', 'blue');

    // App A's value was captured red; App B's scoped key holds blue.
    expect(appAColor).toBe('red');
    expect(readPersisted('app-B').state._state.color).toBe('blue');
    // The two scopes are distinct localStorage keys.
    expect(`${PERSIST_KEY}:app-A`).not.toBe(`${PERSIST_KEY}:app-B`);
  });
});

// ─── Legacy migration ────────────────────────────────────────────────────────────

describe('AppStateStore — legacy global-key migration', () => {
  it('migrates a legacy global blob to the scoped key on read (getItem)', () => {
    // Seed a legacy, unscoped blob as a prior version would have written.
    const legacyBlob = JSON.stringify({
      state: { _state: { color: 'legacy' }, _initialized: true },
      version: 0,
    });
    localStorage.setItem(PERSIST_KEY, legacyBlob);
    setCurrentAppId('app-legacy');

    // Trigger a storage read by rehydrating the persist middleware.
    useAppStateStore.persist.rehydrate();

    // Migration moves the blob to the scoped key and removes the global one.
    expect(localStorage.getItem(`${PERSIST_KEY}:app-legacy`)).toBe(legacyBlob);
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull();
    // Rehydrated state reflects the legacy data.
    expect(useAppStateStore.getState().get('color')).toBe('legacy');
  });

  it('does NOT migrate a legacy blob that lacks _initialized (not a real prior session)', () => {
    const junk = JSON.stringify({ state: { _state: { color: 'x' } } });
    localStorage.setItem(PERSIST_KEY, junk);
    setCurrentAppId('app-x');

    useAppStateStore.persist.rehydrate();

    // The global key is left untouched; nothing is copied to the scoped key.
    expect(localStorage.getItem(PERSIST_KEY)).toBe(junk);
    expect(localStorage.getItem(`${PERSIST_KEY}:app-x`)).toBeNull();
  });

  it('does NOT migrate / throw on a malformed (non-JSON) legacy blob', () => {
    localStorage.setItem(PERSIST_KEY, 'not-json{{{');
    setCurrentAppId('app-y');

    // Must swallow the JSON.parse error and leave storage as-is.
    expect(() => useAppStateStore.persist.rehydrate()).not.toThrow();
    expect(localStorage.getItem(PERSIST_KEY)).toBe('not-json{{{');
    expect(localStorage.getItem(`${PERSIST_KEY}:app-y`)).toBeNull();
  });

  it('prefers the already-scoped key over the legacy key (no migration when scoped exists)', () => {
    const scoped = JSON.stringify({
      state: { _state: { color: 'scoped' }, _initialized: true },
      version: 0,
    });
    const legacy = JSON.stringify({
      state: { _state: { color: 'legacy' }, _initialized: true },
      version: 0,
    });
    setCurrentAppId('app-z');
    localStorage.setItem(`${PERSIST_KEY}:app-z`, scoped);
    localStorage.setItem(PERSIST_KEY, legacy);

    useAppStateStore.persist.rehydrate();

    // Scoped value wins; the legacy global is NOT consumed.
    expect(useAppStateStore.getState().get('color')).toBe('scoped');
    expect(localStorage.getItem(PERSIST_KEY)).toBe(legacy);
  });
});

// ─── reset() ────────────────────────────────────────────────────────────────────

describe('AppStateStore — reset()', () => {
  it('clears state, flags, and tracking sets', () => {
    useAppStateStore.getState().initialize({ state: { a: { $persist: true, initial: 1 } } });
    useAppStateStore.getState().set('a', 2);
    expect(useAppStateStore.getState().isInitialized()).toBe(true);

    useAppStateStore.getState().reset();

    expect(useAppStateStore.getState().isInitialized()).toBe(false);
    expect(useAppStateStore.getState().get('a')).toBeUndefined();
    expect(useAppStateStore.getState()._persistKeys.size).toBe(0);
    expect(useAppStateStore.getState()._userModifiedKeys.size).toBe(0);
  });
});
