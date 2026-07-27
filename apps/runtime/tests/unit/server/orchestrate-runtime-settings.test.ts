// @vitest-environment node
/**
 * Pins `buildRuntimeSettings`, the fragile store→agent payload boundary (see
 * MEMORY "Self-host payload boundary mismatches"):
 *   - dotted store key → underscore payload key (`{provider}_api_key`);
 *   - single-provider model: exactly one `image_provider` is emitted and ONLY
 *     the selected provider's key is sent (a typo here silently dead-wires a
 *     stock provider, or leaks a de-selected one to the agent).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setSettings, getAllSettings } from '../../../worker/src/lib/meta-db';
import { buildRuntimeSettings, agentHeaders } from '../../../worker/src/routes/orchestrate';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-orch-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Clear any keys a prior test set, plus the env seeds the provider derivation
  // falls back to (so it can't leak a provider pick between tests).
  setSettings({
    'images.provider': null,
    'images.keep_llm_urls': null,
    'pexels.api_key': null,
    'unsplash.api_key': null,
    'pixabay.api_key': null,
    'llm.provider': null,
  });
  delete process.env.PEXELS_API_KEY;
  delete process.env.UNSPLASH_API_KEY;
  delete process.env.PIXABAY_API_KEY;
  delete process.env.IMAGE_PROVIDER;
});

describe('buildRuntimeSettings', () => {
  it('emits the selected provider + only its key (dotted → underscore)', () => {
    setSettings({ 'images.provider': 'pexels', 'pexels.api_key': 'px' });
    const out = buildRuntimeSettings()!;
    expect(out.image_provider).toBe('pexels');
    expect(out.pexels_api_key).toBe('px');
  });

  it('never sends a de-selected provider key to the agent', () => {
    // All three keys stored, but only Unsplash is the active pick.
    setSettings({
      'images.provider': 'unsplash',
      'pexels.api_key': 'px',
      'unsplash.api_key': 'us',
      'pixabay.api_key': 'pb',
    });
    const out = buildRuntimeSettings()!;
    expect(out.image_provider).toBe('unsplash');
    expect(out.unsplash_api_key).toBe('us');
    expect('pexels_api_key' in out).toBe(false);
    expect('pixabay_api_key' in out).toBe(false);
  });

  it('derives the provider from a stored key when none is explicitly picked', () => {
    setSettings({ 'pixabay.api_key': 'only-pixabay' });
    const out = buildRuntimeSettings()!;
    expect(out.image_provider).toBe('pixabay');
    expect(out.pixabay_api_key).toBe('only-pixabay');
  });

  it('emits keyless openverse with no provider keys when it is the pick', () => {
    setSettings({ 'images.provider': 'openverse' });
    const out = buildRuntimeSettings()!;
    expect(out.image_provider).toBe('openverse');
    expect('pexels_api_key' in out).toBe(false);
    expect('unsplash_api_key' in out).toBe(false);
    expect('pixabay_api_key' in out).toBe(false);
  });

  it('returns undefined when the store has nothing relevant', () => {
    expect(getAllSettings()['pexels.api_key']).toBeUndefined();
    expect(getAllSettings()['images.provider']).toBeUndefined();
    expect(buildRuntimeSettings()).toBeUndefined();
  });

  it('emits keep_llm_image_urls as a boolean only when explicitly stored', () => {
    // Not stored → omitted entirely (agent keeps its default).
    setSettings({ 'images.provider': 'openverse' });
    expect('keep_llm_image_urls' in buildRuntimeSettings()!).toBe(false);

    // Stored false → emitted as boolean false.
    setSettings({ 'images.keep_llm_urls': 'false' });
    expect(buildRuntimeSettings()!.keep_llm_image_urls).toBe(false);

    // Stored true → emitted as boolean true.
    setSettings({ 'images.keep_llm_urls': 'true' });
    expect(buildRuntimeSettings()!.keep_llm_image_urls).toBe(true);
  });

  it('emits keep_llm_image_urls even with no other image settings', () => {
    setSettings({ 'images.keep_llm_urls': 'false' });
    const out = buildRuntimeSettings()!;
    expect(out.keep_llm_image_urls).toBe(false);
    expect('image_provider' in out).toBe(false);
  });
});

// The direct worker→agent build path must carry the shared internal token the
// agent enforces (X-Exepad-Internal-Secret), exactly like the /agent/* proxy —
// otherwise every build 403s once EXEPAD_AGENT_INTERNAL_SECRET is configured.
describe('agentHeaders (worker→agent internal token)', () => {
  const saved = process.env.EXEPAD_AGENT_INTERNAL_SECRET;
  afterAll(() => {
    if (saved === undefined) delete process.env.EXEPAD_AGENT_INTERNAL_SECRET;
    else process.env.EXEPAD_AGENT_INTERNAL_SECRET = saved;
  });

  it('stamps X-Exepad-Internal-Secret when the secret is configured', () => {
    process.env.EXEPAD_AGENT_INTERNAL_SECRET = 'sekret-64';
    const h = agentHeaders({ 'Content-Type': 'application/json' });
    expect(h['X-Exepad-Internal-Secret']).toBe('sekret-64');
    expect(h['Content-Type']).toBe('application/json'); // merges extra headers
  });

  it('omits the header when the secret is not configured', () => {
    delete process.env.EXEPAD_AGENT_INTERNAL_SECRET;
    const h = agentHeaders({ 'Content-Type': 'application/json' });
    expect('X-Exepad-Internal-Secret' in h).toBe(false);
    expect(h['Content-Type']).toBe('application/json');
  });
});
