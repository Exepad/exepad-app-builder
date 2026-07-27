/**
 * App display-name helpers shared by the build pump and the maintenance backfill.
 *
 * The platform metadata `apps.name` (meta.sqlite) is what the dashboard cards and
 * the studio header show. It is seeded once at create time with a prompt-derived
 * placeholder ({@link deriveAppName}) because the real name isn't known yet — the
 * agent invents/extracts it during the build and writes it into the assembled
 * config's top-level `name` (AppProps.name, e.g. "Lumina"). Nothing used to copy
 * that real name back, so the card showed the prompt forever. These helpers let
 * the worker (a) seed the agent so it actually brands the app, and (b) pull the
 * resulting name out of the config to sync into `apps.name`.
 */

/**
 * Generic placeholder names the agent uses before — or when it fails to invent —
 * a real brand name. This is the union of the Creator's recognized generics
 * (`creator.py`: "New App"/"My App"/"Untitled App"/"Untitled") and the design
 * importer's `_PLACEHOLDER_APP_NAMES` (`design_import_workflow.py`). We refuse to
 * persist any of them, so a sync never overwrites a usable name with "New App".
 */
const GENERIC_APP_NAMES: ReadonlySet<string> = new Set([
  '',
  'app',
  'my app',
  'new app',
  'untitled',
  'untitled app',
  'test',
  'create',
  'make me an app',
]);

export function isGenericAppName(name: string): boolean {
  return GENERIC_APP_NAMES.has(name.trim().toLowerCase());
}

/**
 * The name to seed a fresh, un-named create with so the agent's "name is generic
 * → invent a brand-able name" path fires. It must be recognized as generic by
 * BOTH agent paths: the Creator's naming rule AND the design importer's
 * "user value always wins" reconciliation (which would otherwise pin the name to
 * whatever non-generic string we send — i.e. the prompt prefix). "New App" is a
 * member of {@link GENERIC_APP_NAMES} honored by both.
 */
export const GENERIC_AGENT_APP_NAME = 'New App';

/** Hard cap for a stored name — matches the apps.name column's practical width
 *  and the legacy deriveName cap. */
const MAX_NAME_LEN = 80;

/**
 * Derive a human-ish placeholder name from the build prompt, used as the
 * meta.sqlite `apps.name` until the agent's real name is synced in. This is only
 * a placeholder + fallback (shown while the build runs, or kept if the agent
 * returns a generic name), so it errs toward something readable:
 *   - a name the user quoted in the prompt wins: `Build "Momentum", a tracker` → `Momentum`
 *   - otherwise a leading build instruction is stripped: `Create an expense app` → `expense app`
 *   - then the first few words, capped at {@link MAX_NAME_LEN}.
 */
export function deriveAppName(prompt: string): string {
  const normalized = (prompt ?? '').replace(/\s+/g, ' ').trim();

  // A double-quoted span (straight or curly) is almost always the chosen name.
  // Single quotes are avoided — they collide with apostrophes ("don't", "user's").
  const quoted = normalized.match(/["“”]([^"“”]{2,40})["“”]/);
  if (quoted) {
    const inner = quoted[1].trim();
    if (inner) return inner.slice(0, MAX_NAME_LEN);
  }

  const stripped = normalized.replace(
    /^(please\s+)?(build|create|make|generate|design|develop)(\s+me)?\s+(an?|the)?\s*/i,
    '',
  );
  const words = (stripped || normalized).split(' ').slice(0, 6).join(' ');
  return (words || 'Untitled App').slice(0, MAX_NAME_LEN);
}

/**
 * Pull a usable display name out of an assembled app config, or `null` when the
 * config only offers a generic placeholder (so the caller keeps the existing
 * name rather than regressing to "New App").
 *
 * `name` (AppProps.name) is the canonical app name, so it's preferred; we fall
 * back to the frontend title surfaces the SSR meta-injector also reads
 * (`frontend.appName`, `frontend.metadata.title`) so the card and the browser
 * tab converge on the same identity.
 */
export function displayNameFromConfig(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  const frontend = (c.frontend && typeof c.frontend === 'object'
    ? (c.frontend as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const metadata = (frontend.metadata && typeof frontend.metadata === 'object'
    ? (frontend.metadata as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  for (const candidate of [c.name, frontend.appName, metadata.title]) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed || isGenericAppName(trimmed)) continue;
    return trimmed.slice(0, MAX_NAME_LEN);
  }
  return null;
}
