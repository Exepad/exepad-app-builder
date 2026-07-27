// @vitest-environment node
/**
 * Keystone tests for the operator settings feature.
 *
 *   - meta.sqlite settings store: upsert / keep-on-undefined / delete-on-null
 *   - GET /api/settings: auth guard, secret masking (never echoes the raw key),
 *     env fallback when the store is empty
 *   - PUT /api/settings: persists provider/model, keeps a secret when omitted,
 *     replaces it when provided, validates the provider
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getSetting, getAllSettings, setSettings } from '../../../worker/src/lib/meta-db';
import { hashPassword } from '../../../worker/src/lib/password';
import { createUser } from '../../../worker/src/lib/meta-db';
import { mintSessionToken, PLATFORM_SESSION_COOKIE } from '../../../worker/src/routes/gateway/auth';
import { settings as settingsRoute } from '../../../worker/src/routes/settings';
import type { Env } from '../../../worker/src/types/env';

const SECRET = 'test-session-secret-settings-123456';
let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'exepad-settings-'));
  process.env.EXEPAD_DATA_DIR = dataDir;
  process.env.EXEPAD_META_DB = join(dataDir, 'meta.sqlite');
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.EXEPAD_LLM_API_KEY;
});

function env(): Env {
  return { PLATFORM_BRIDGE_SECRET: SECRET } as unknown as Env;
}

async function authedCookie(): Promise<{ cookie: string }> {
  const user = createUser(`settings-${Math.random().toString(36).slice(2)}@x.com`, await hashPassword('pw'));
  const token = await mintSessionToken(user.id, user.email, ['admin'], SECRET);
  return { cookie: `${PLATFORM_SESSION_COOKIE}=${token}` };
}

describe('settings store', () => {
  it('upserts, keeps on undefined, and deletes on null', () => {
    setSettings({ 'llm.provider': 'openrouter', 'llm.model': 'anthropic/claude-3.5-sonnet' });
    expect(getSetting('llm.provider')).toBe('openrouter');
    expect(getSetting('llm.model')).toBe('anthropic/claude-3.5-sonnet');

    // undefined leaves the key untouched.
    setSettings({ 'llm.provider': undefined, 'llm.model': 'openai/gpt-4o' });
    expect(getSetting('llm.provider')).toBe('openrouter');
    expect(getSetting('llm.model')).toBe('openai/gpt-4o');

    // null deletes.
    setSettings({ 'llm.model': null });
    expect(getSetting('llm.model')).toBeNull();
    expect(getAllSettings()['llm.provider']).toBe('openrouter');
  });
});

describe('GET /api/settings', () => {
  it('requires auth', async () => {
    const res = await settingsRoute.fetch(new Request('https://host/'), env());
    expect(res.status).toBe(401);
  });

  it('masks the API key and never echoes the raw value', async () => {
    setSettings({ 'llm.api_key': 'sk-or-secret-abcd1234', 'llm.provider': 'openrouter' });
    const { cookie } = await authedCookie();
    const res = await settingsRoute.fetch(
      new Request('https://host/', { headers: { Cookie: cookie } }),
      env(),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('sk-or-secret-abcd1234');
    const body = JSON.parse(raw) as {
      settings: { llm: { provider: string; apiKey: { set: boolean; source: string; hint: string } } };
    };
    expect(body.settings.llm.provider).toBe('openrouter');
    expect(body.settings.llm.apiKey.set).toBe(true);
    expect(body.settings.llm.apiKey.source).toBe('store');
    expect(body.settings.llm.apiKey.hint).toContain('1234');
  });

  it('falls back to the process environment when the store is empty', async () => {
    setSettings({ 'pexels.api_key': null }); // ensure unset in store
    process.env.PEXELS_API_KEY = 'env-pexels-key-9999';
    const { cookie } = await authedCookie();
    const res = await settingsRoute.fetch(
      new Request('https://host/', { headers: { Cookie: cookie } }),
      env(),
    );
    const body = (await res.json()) as {
      settings: { images: { pexels: { apiKey: { set: boolean; source: string } } } };
    };
    expect(body.settings.images.pexels.apiKey.set).toBe(true);
    expect(body.settings.images.pexels.apiKey.source).toBe('env');
    delete process.env.PEXELS_API_KEY;
  });

  it('reports unsplash + pixabay keys with env fallback', async () => {
    setSettings({ 'unsplash.api_key': null, 'pixabay.api_key': null });
    process.env.UNSPLASH_API_KEY = 'env-unsplash-key-7777';
    process.env.PIXABAY_API_KEY = 'env-pixabay-key-8888';
    const { cookie } = await authedCookie();
    const res = await settingsRoute.fetch(
      new Request('https://host/', { headers: { Cookie: cookie } }),
      env(),
    );
    const body = (await res.json()) as {
      settings: {
        images: {
          unsplash: { apiKey: { set: boolean; source: string } };
          pixabay: { apiKey: { set: boolean; source: string } };
        };
      };
    };
    expect(body.settings.images.unsplash.apiKey.set).toBe(true);
    expect(body.settings.images.unsplash.apiKey.source).toBe('env');
    expect(body.settings.images.pixabay.apiKey.set).toBe(true);
    expect(body.settings.images.pixabay.apiKey.source).toBe('env');
    delete process.env.UNSPLASH_API_KEY;
    delete process.env.PIXABAY_API_KEY;
  });

  it('reports the active image provider — explicit pick wins, else derived, else openverse', async () => {
    const { cookie } = await authedCookie();
    async function providerOf(): Promise<string> {
      const res = await settingsRoute.fetch(
        new Request('https://host/', { headers: { Cookie: cookie } }),
        env(),
      );
      const body = (await res.json()) as { settings: { images: { provider: string } } };
      return body.settings.images.provider;
    }

    // No keys, no pick → keyless Openverse default.
    setSettings({
      'images.provider': null,
      'pexels.api_key': null,
      'unsplash.api_key': null,
      'pixabay.api_key': null,
    });
    delete process.env.PEXELS_API_KEY;
    expect(await providerOf()).toBe('openverse');

    // A stored key with no explicit pick derives that provider.
    setSettings({ 'unsplash.api_key': 'us-derive-key' });
    expect(await providerOf()).toBe('unsplash');

    // An explicit pick wins even when a different provider's key is stored.
    setSettings({ 'images.provider': 'pixabay' });
    expect(await providerOf()).toBe('pixabay');

    setSettings({ 'images.provider': null, 'unsplash.api_key': null });
  });

  it('reports keepLlmUrls — default true, false only when explicitly stored', async () => {
    const { cookie } = await authedCookie();
    delete process.env.KEEP_LLM_IMAGE_URLS;
    async function keepOf(): Promise<boolean> {
      const res = await settingsRoute.fetch(
        new Request('https://host/', { headers: { Cookie: cookie } }),
        env(),
      );
      const body = (await res.json()) as { settings: { images: { keepLlmUrls: boolean } } };
      return body.settings.images.keepLlmUrls;
    }

    setSettings({ 'images.keep_llm_urls': null });
    expect(await keepOf()).toBe(true); // unset → default on

    setSettings({ 'images.keep_llm_urls': 'false' });
    expect(await keepOf()).toBe(false);

    setSettings({ 'images.keep_llm_urls': 'true' });
    expect(await keepOf()).toBe(true);

    setSettings({ 'images.keep_llm_urls': null });
  });
});

describe('PUT /api/settings', () => {
  it('persists fields, keeps a secret when omitted, replaces it when sent', async () => {
    const { cookie } = await authedCookie();
    setSettings({ 'llm.api_key': 'sk-or-original-key-0001' });

    // Omitting apiKey keeps the existing one; provider/model are updated.
    const put1 = await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm: { provider: 'openrouter', model: 'x-ai/grok-2' } }),
      }),
      env(),
    );
    expect(put1.status).toBe(200);
    expect(getSetting('llm.model')).toBe('x-ai/grok-2');
    expect(getSetting('llm.api_key')).toBe('sk-or-original-key-0001');

    // Sending a new apiKey replaces it.
    await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm: { apiKey: 'sk-or-replaced-key-0002' } }),
      }),
      env(),
    );
    expect(getSetting('llm.api_key')).toBe('sk-or-replaced-key-0002');
  });

  it('persists pexels/unsplash/pixabay secrets and never echoes them', async () => {
    const { cookie } = await authedCookie();
    const put = await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pexels: { apiKey: 'px-secret-1234' },
          unsplash: { apiKey: 'us-secret-5678' },
          pixabay: { apiKey: 'pb-secret-9012' },
        }),
      }),
      env(),
    );
    expect(put.status).toBe(200);
    // Stored under the dotted store keys (the fragile dotted↔underscore hop).
    expect(getSetting('pexels.api_key')).toBe('px-secret-1234');
    expect(getSetting('unsplash.api_key')).toBe('us-secret-5678');
    expect(getSetting('pixabay.api_key')).toBe('pb-secret-9012');

    // GET masks them (set + source store + tail hint), never the raw value.
    const getRes = await settingsRoute.fetch(
      new Request('https://host/', { headers: { Cookie: cookie } }),
      env(),
    );
    const raw = await getRes.text();
    expect(raw).not.toContain('px-secret-1234');
    expect(raw).not.toContain('pb-secret-9012');
    const body = JSON.parse(raw) as {
      settings: { images: { pixabay: { apiKey: { set: boolean; source: string; hint: string } } } };
    };
    expect(body.settings.images.pixabay.apiKey.set).toBe(true);
    expect(body.settings.images.pixabay.apiKey.source).toBe('store');
    expect(body.settings.images.pixabay.apiKey.hint).toContain('9012');

    // Omitting a provider key on a later PUT keeps the stored value.
    await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pexels: {} }),
      }),
      env(),
    );
    expect(getSetting('pexels.api_key')).toBe('px-secret-1234');
  });

  it('rejects an unknown provider', async () => {
    const { cookie } = await authedCookie();
    const res = await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm: { provider: 'skynet' } }),
      }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('persists the image provider pick and the selected provider key (nested shape)', async () => {
    const { cookie } = await authedCookie();
    const res = await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: { provider: 'pexels', pexels: { apiKey: 'px-nested-1' } } }),
      }),
      env(),
    );
    expect(res.status).toBe(200);
    expect(getSetting('images.provider')).toBe('pexels');
    expect(getSetting('pexels.api_key')).toBe('px-nested-1');

    // Switching to keyless Openverse persists the pick; a previously stored key
    // is left untouched (only the active provider's key is ever sent onward).
    await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: { provider: 'openverse' } }),
      }),
      env(),
    );
    expect(getSetting('images.provider')).toBe('openverse');
    expect(getSetting('pexels.api_key')).toBe('px-nested-1');
  });

  it('persists keepLlmUrls as a string; omitting it keeps the stored value', async () => {
    const { cookie } = await authedCookie();

    // Explicit false persists as the 'false' string.
    await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: { provider: 'openverse', keepLlmUrls: false } }),
      }),
      env(),
    );
    expect(getSetting('images.keep_llm_urls')).toBe('false');

    // Omitting keepLlmUrls on a later PUT leaves the stored value untouched.
    await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: { provider: 'openverse' } }),
      }),
      env(),
    );
    expect(getSetting('images.keep_llm_urls')).toBe('false');

    // Sending true flips it back.
    await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: { provider: 'openverse', keepLlmUrls: true } }),
      }),
      env(),
    );
    expect(getSetting('images.keep_llm_urls')).toBe('true');

    setSettings({ 'images.keep_llm_urls': null });
  });

  it('rejects an unknown image provider', async () => {
    const { cookie } = await authedCookie();
    const res = await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: { provider: 'shutterstock' } }),
      }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const res = await settingsRoute.fetch(
      new Request('https://host/', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm: { provider: 'openrouter' } }),
      }),
      env(),
    );
    expect(res.status).toBe(401);
  });
});
