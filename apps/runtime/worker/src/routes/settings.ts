/**
 * Operator settings (self-hosted single container).
 *
 * The settings page lets the operator configure the instance at runtime without
 * editing env files or restarting the container. Values are stored in
 * `meta.sqlite` (see `lib/meta-db.ts`) and OVERRIDE the process environment,
 * which only acts as the first-boot seed / fallback.
 *
 *   GET  /api/settings          → effective settings (secrets masked, never echoed)
 *   PUT  /api/settings          → upsert settings (omit a secret to keep it)
 *   GET  /api/settings/models   → proxy the OpenRouter model catalogue
 *
 * The LLM settings are read back by `routes/orchestrate.ts` and injected into the
 * agent `/r` payload (`runtime_settings`), so a saved key/model takes effect on
 * the next build with no restart. All routes require an authenticated operator.
 */
import { Hono } from 'hono';
import type { Env } from '../types/env';
import { requirePlatformUser } from './auth';
import { getAllSettings, setSettings } from '../lib/meta-db';

export const settings = new Hono<{ Bindings: Env }>();

// ─── Setting keys ─────────────────────────────────────────────────────────────
// Flat keys in the `settings` table. `S` = secret (never echoed to the client);
// the process-env fallback used when the store has no value.
const KEYS = {
  llmProvider: { key: 'llm.provider', env: 'EXEPAD_LLM_PROVIDER', secret: false },
  llmModel: { key: 'llm.model', env: 'EXEPAD_LLM_MODEL_DEFAULT', secret: false },
  llmBaseUrl: { key: 'llm.base_url', env: 'EXEPAD_LLM_BASE_URL', secret: false },
  llmApiKey: { key: 'llm.api_key', env: 'EXEPAD_LLM_API_KEY', secret: true },
  // OpenRouter provider-routing pin (optional). `providerOrder` is a
  // comma-separated slug list; `providerSort` is price|throughput|latency.
  // Both disable OpenRouter's per-call load-balancing (see the agent's
  // config._openrouter_provider_routing) to kill first-call cold-routing spikes.
  llmProviderOrder: { key: 'llm.provider_order', env: 'EXEPAD_LLM_PROVIDER_ORDER', secret: false },
  llmProviderSort: { key: 'llm.provider_sort', env: 'EXEPAD_LLM_PROVIDER_SORT', secret: false },
  imageProvider: { key: 'images.provider', env: 'IMAGE_PROVIDER', secret: false },
  imageKeepLlmUrls: { key: 'images.keep_llm_urls', env: 'KEEP_LLM_IMAGE_URLS', secret: false },
  pexelsApiKey: { key: 'pexels.api_key', env: 'PEXELS_API_KEY', secret: true },
  unsplashApiKey: { key: 'unsplash.api_key', env: 'UNSPLASH_API_KEY', secret: true },
  pixabayApiKey: { key: 'pixabay.api_key', env: 'PIXABAY_API_KEY', secret: true },
} as const;

// Values that turn a default-ON boolean setting OFF. Anything else (including
// an unset value) keeps the default. Mirrors the agent's KEEP_LLM_IMAGE_URLS
// parsing in image_generation_utils.keep_llm_image_urls().
const FALSEY = new Set(['0', 'false', 'no', 'off']);

const DEFAULT_PROVIDER = 'openrouter';

// ─── Stock-image provider (single active provider) ────────────────────────────
// Exactly one stock-image source is active at a time. Openverse is the keyless
// default (and always the silent last-resort fallback in the agent); the other
// three are keyed. Keys for non-selected providers may stay stored, but only the
// SELECTED provider's key is sent to the agent per build (see orchestrate.ts).
export const IMAGE_PROVIDERS = ['openverse', 'pexels', 'unsplash', 'pixabay'] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

/** The keyed providers, in the stable order used to derive a default selection
 *  for installs that configured a key but never picked a provider in the UI. */
const KEYED_PROVIDER_SPECS: Array<{ name: ImageProvider; spec: { key: string; env: string } }> = [
  { name: 'pexels', spec: KEYS.pexelsApiKey },
  { name: 'unsplash', spec: KEYS.unsplashApiKey },
  { name: 'pixabay', spec: KEYS.pixabayApiKey },
];

/**
 * The single active stock-image provider for the given settings store.
 *
 * Precedence: an explicit UI selection wins; otherwise we derive one from the
 * first keyed provider that has a key (store or env seed) so pre-existing
 * key-only installs keep working; otherwise the keyless Openverse default.
 */
export function effectiveImageProvider(store: Record<string, string>): ImageProvider {
  const explicit = effective(store, KEYS.imageProvider).trim().toLowerCase();
  if ((IMAGE_PROVIDERS as readonly string[]).includes(explicit)) {
    return explicit as ImageProvider;
  }
  for (const { name, spec } of KEYED_PROVIDER_SPECS) {
    if (secretView(store, spec).set) return name;
  }
  return 'openverse';
}

/** Store value, falling back to the process environment (the first-boot seed). */
function effective(store: Record<string, string>, spec: { key: string; env: string }): string {
  const v = store[spec.key];
  if (typeof v === 'string' && v.length > 0) return v;
  return process.env[spec.env] ?? '';
}

/** A default-ON boolean setting: ON unless the effective value is explicitly falsey. */
function effectiveBoolDefaultOn(
  store: Record<string, string>,
  spec: { key: string; env: string },
): boolean {
  return !FALSEY.has(effective(store, spec).trim().toLowerCase());
}

/** Describe a secret for display without ever returning its value. */
function secretView(store: Record<string, string>, spec: { key: string; env: string }) {
  const fromStore = store[spec.key];
  if (typeof fromStore === 'string' && fromStore.length > 0) {
    return { set: true, source: 'store' as const, hint: hint(fromStore) };
  }
  const fromEnv = process.env[spec.env];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return { set: true, source: 'env' as const, hint: hint(fromEnv) };
  }
  return { set: false, source: 'none' as const, hint: '' };
}

function hint(value: string): string {
  const tail = value.slice(-4);
  return tail ? `••••${tail}` : '••••';
}

// ─── GET /api/settings ────────────────────────────────────────────────────────

settings.get('/', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const store = getAllSettings();
  return c.json({
    success: true,
    settings: {
      llm: {
        provider: effective(store, KEYS.llmProvider) || DEFAULT_PROVIDER,
        model: effective(store, KEYS.llmModel),
        baseUrl: effective(store, KEYS.llmBaseUrl),
        apiKey: secretView(store, KEYS.llmApiKey),
        providerOrder: effective(store, KEYS.llmProviderOrder),
        providerSort: effective(store, KEYS.llmProviderSort),
      },
      images: {
        provider: effectiveImageProvider(store),
        keepLlmUrls: effectiveBoolDefaultOn(store, KEYS.imageKeepLlmUrls),
        pexels: { apiKey: secretView(store, KEYS.pexelsApiKey) },
        unsplash: { apiKey: secretView(store, KEYS.unsplashApiKey) },
        pixabay: { apiKey: secretView(store, KEYS.pixabayApiKey) },
      },
    },
  });
});

// ─── PUT /api/settings ──────────────────────────────────────────────────────--

interface ImageKeyInput {
  apiKey?: string;
}
interface PutBody {
  llm?: {
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    providerOrder?: string;
    providerSort?: string;
  };
  images?: {
    provider?: string;
    keepLlmUrls?: boolean;
    pexels?: ImageKeyInput;
    unsplash?: ImageKeyInput;
    pixabay?: ImageKeyInput;
  };
  // Legacy top-level provider blocks (pre-single-provider clients). Still
  // accepted so an older UI keeps working; the nested `images` shape wins.
  pexels?: ImageKeyInput;
  unsplash?: ImageKeyInput;
  pixabay?: ImageKeyInput;
}

/** A secret field: store only when a non-empty value is sent; otherwise keep the
 * existing one (`undefined` = no change for setSettings). */
function secretUpdate(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** A plain field: a string (even empty, to clear) updates; anything else skips. */
function plainUpdate(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

settings.put('/', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  let body: PutBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const llm = body.llm ?? {};
  const provider = plainUpdate(llm.provider);
  if (provider !== undefined && provider.length > 0) {
    const allowed = ['openrouter', 'gemini', 'anthropic', 'openai', 'custom'];
    if (!allowed.includes(provider)) {
      return c.json({ success: false, error: `Unknown provider: ${provider}` }, 400);
    }
  }

  // OpenRouter provider-routing pin. `providerSort`, when non-empty, must be one
  // of OpenRouter's sort axes; `providerOrder` is a free-form slug CSV.
  const providerSort = plainUpdate(llm.providerSort);
  if (providerSort !== undefined && providerSort.length > 0) {
    const allowedSort = ['price', 'throughput', 'latency'];
    if (!allowedSort.includes(providerSort.toLowerCase())) {
      return c.json({ success: false, error: `Unknown provider sort: ${providerSort}` }, 400);
    }
  }

  // Stock images: nested `images` block wins; fall back to legacy top-level keys.
  const images = body.images ?? {};
  const imageProvider = plainUpdate(images.provider);
  if (imageProvider !== undefined && imageProvider.length > 0) {
    if (!(IMAGE_PROVIDERS as readonly string[]).includes(imageProvider)) {
      return c.json({ success: false, error: `Unknown image provider: ${imageProvider}` }, 400);
    }
  }
  const pexels = images.pexels ?? body.pexels;
  const unsplash = images.unsplash ?? body.unsplash;
  const pixabay = images.pixabay ?? body.pixabay;

  // Keep-LLM-image-URLs toggle (default ON). Persist a 'true'/'false' string
  // only when the client sends an explicit boolean; anything else is a no-op.
  const keepLlmUrls =
    typeof images.keepLlmUrls === 'boolean' ? String(images.keepLlmUrls) : undefined;

  setSettings({
    [KEYS.llmProvider.key]: provider,
    [KEYS.llmModel.key]: plainUpdate(llm.model),
    [KEYS.llmBaseUrl.key]: plainUpdate(llm.baseUrl),
    [KEYS.llmApiKey.key]: secretUpdate(llm.apiKey),
    [KEYS.llmProviderOrder.key]: plainUpdate(llm.providerOrder),
    [KEYS.llmProviderSort.key]: providerSort,
    [KEYS.imageProvider.key]: imageProvider,
    [KEYS.imageKeepLlmUrls.key]: keepLlmUrls,
    [KEYS.pexelsApiKey.key]: secretUpdate(pexels?.apiKey),
    [KEYS.unsplashApiKey.key]: secretUpdate(unsplash?.apiKey),
    [KEYS.pixabayApiKey.key]: secretUpdate(pixabay?.apiKey),
  });

  return c.json({ success: true });
});

// ─── GET /api/settings/models — OpenRouter catalogue proxy ───────────────────--
//
// Proxied server-side (avoids browser CORS) and cached in-process. The public
// /models list needs no API key. On any failure we return success:false and the
// UI falls back to a free-text model field.

interface ModelEntry {
  id: string;
  name: string;
  contextLength: number | null;
}
let modelsCache: { at: number; provider: string; models: ModelEntry[] } | null = null;
const MODELS_TTL_MS = 60 * 60 * 1000;

settings.get('/models', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const provider = (c.req.query('provider') || DEFAULT_PROVIDER).toLowerCase();
  if (provider !== 'openrouter') {
    return c.json({ success: true, models: [] });
  }

  const now = Date.now();
  if (modelsCache && modelsCache.provider === provider && now - modelsCache.at < MODELS_TTL_MS) {
    return c.json({ success: true, models: modelsCache.models, cached: true });
  }

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        context_length?: number;
      }>;
    };
    const models: ModelEntry[] = (data.data ?? [])
      .filter((m): m is { id: string; name?: string; context_length?: number } => Boolean(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    modelsCache = { at: now, provider, models };
    return c.json({ success: true, models });
  } catch (e) {
    return c.json(
      { success: false, error: `Could not load OpenRouter models: ${e}`, models: [] },
      502,
    );
  }
});

// ─── GET /api/settings/update-check ──────────────────────────────────────────
// Read-only "is a newer studio version published?" probe for the in-app banner.
// The container CANNOT update itself (the process that pulls + recreates it
// would die mid-update — the bootstrapping rule), so this only *informs*; the
// operator applies with `npx exepad-app-builder update` (which backs up /data first).
//
//   current  = EXEPAD_VERSION, baked at image build (release.yml build-arg);
//              'dev' on local/source builds → comparison is skipped.
//   latest   = newest GitHub release tag, cached 6h (30min after a failure) so
//              a busy studio never hammers the API and an offline box degrades
//              to a silent no-op.
//   Opt-outs: EXEPAD_UPDATE_CHECK=0/false/no/off, or EXEPAD_NO_OUTBOUND=1
//             (the air-gap knob the entrypoint already honors for IP echo).

const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const UPDATE_CHECK_FAIL_TTL_MS = 30 * 60 * 1000;
let updateCache: { at: number; latest: string | null } | null = null;

/**
 * Strictly-newer semver compare incl. prerelease precedence (SemVer §11:
 * 1.2.3-rc.1 < 1.2.3); null when either side is not semver. Prerelease
 * handling matters here: an operator on `1.2.3-beta` must be told the stable
 * `1.2.3` is newer, and this comparator must agree with the CLI's downgrade
 * logic (packages/exepad-cli/src/version.ts) — the two live in different
 * packages, so keep the semantics aligned when touching either.
 */
function semverNewer(latest: string, current: string): boolean | null {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.replace(/^v/, ''));
  const l = parse(latest);
  const c = parse(current);
  if (!l || !c) return null;
  for (let i = 1; i <= 3; i++) {
    const a = Number(l[i]);
    const b = Number(c[i]);
    if (a !== b) return a > b;
  }
  // Equal cores: no-prerelease > prerelease; two prereleases compare per-identifier.
  const lp = l[4];
  const cp = c[4];
  if (lp === cp) return false;
  if (!lp) return true; // latest is the stable release of current's prerelease
  if (!cp) return false; // latest is a prerelease of the current stable
  const la = lp.split('.');
  const ca = cp.split('.');
  for (let i = 0; i < Math.max(la.length, ca.length); i++) {
    const x = la[i];
    const y = ca[i];
    if (x === undefined) return false; // shorter prerelease sorts lower
    if (y === undefined) return true;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) > Number(y);
    if (xn !== yn) return yn; // numeric identifiers sort below alphanumeric
    return x > y;
  }
  return false;
}

settings.get('/update-check', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) return c.json({ success: false, error: 'Not authenticated' }, 401);

  const current = (process.env.EXEPAD_VERSION ?? 'dev').trim() || 'dev';

  const optedOut =
    FALSEY.has((process.env.EXEPAD_UPDATE_CHECK ?? '').trim().toLowerCase()) ||
    ['1', 'true', 'yes', 'on'].includes((process.env.EXEPAD_NO_OUTBOUND ?? '').trim().toLowerCase());
  if (optedOut) {
    return c.json({ success: true, enabled: false, current, latest: null, updateAvailable: null });
  }

  const now = Date.now();
  const ttl = updateCache?.latest ? UPDATE_CHECK_TTL_MS : UPDATE_CHECK_FAIL_TTL_MS;
  if (!updateCache || now - updateCache.at > ttl) {
    let latest: string | null = null;
    try {
      const repo = (process.env.EXEPAD_RELEASES_REPO ?? 'exepad/exepad-app-builder').trim();
      const resp = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          // GitHub's API rejects requests without a User-Agent.
          'User-Agent': `exepad-studio/${current}`,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { tag_name?: string };
        const tag = (data.tag_name ?? '').trim();
        if (tag) latest = tag.replace(/^v/, '');
      }
    } catch {
      // Offline / rate-limited / DNS-blocked — degrade silently; retry sooner.
    }
    updateCache = { at: now, latest };
  }

  const latest = updateCache.latest;
  return c.json({
    success: true,
    enabled: true,
    current,
    latest,
    // null = unknown (no latest fetched, or a non-semver current like 'dev').
    updateAvailable: latest ? semverNewer(latest, current) : null,
    applyWith: latest ? `npx exepad-app-builder update --to ${latest}` : null,
  });
});
