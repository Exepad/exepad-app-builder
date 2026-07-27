import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  getSecurity,
  saveSecurity,
  type AdminMode,
  type AppSecurity,
  type AuthProvider,
} from '../../services/AdminApi';
import { btn, inputClass, Spinner, ErrorBanner } from './ui';

const ACCESS_LEVELS: Array<{ value: NonNullable<AppSecurity['defaultAccess']>; label: string }> = [
  { value: 'public', label: 'Public — anyone' },
  { value: 'authenticated', label: 'Authenticated — any logged-in user' },
  { value: 'owner', label: 'Owner — only the record owner' },
  { value: 'none', label: 'None — no access by default' },
];

const PROVIDERS: AuthProvider[] = ['email', 'google'];

/** Local editable shape, with seconds↔days handled in the UI. */
interface FormState {
  enabled: boolean;
  providers: Set<AuthProvider>;
  allowSignup: boolean;
  requireVerification: boolean;
  defaultAccess: NonNullable<AppSecurity['defaultAccess']>;
  roles: string;
  defaultRole: string;
  sessionDays: number;
  minLength: number;
}

function toForm(s: AppSecurity | null): FormState {
  const providers = new Set<AuthProvider>(
    (s?.authProviders ?? []).map((p) => p.provider).filter((p): p is AuthProvider => p === 'email' || p === 'google'),
  );
  if (!s && providers.size === 0) providers.add('email');
  return {
    // Mirror the RUNTIME's interpretation: auth is enabled when a security
    // object exists and `enabled` is not explicitly `false` (the app-backend
    // gates on `config.security?.enabled === false`). The agent omits the
    // `enabled` field, so reading `s?.enabled ?? false` showed "Authentication
    // OFF" — and disabled every sub-setting — for apps that actually require
    // login. Only a truly absent security object (no auth configured) is off.
    enabled: s ? s.enabled !== false : false,
    providers,
    allowSignup: s?.allowSignup ?? true,
    requireVerification: s?.requireVerification ?? false,
    defaultAccess: s?.defaultAccess ?? 'public',
    roles: (s?.roles ?? []).join(', '),
    defaultRole: s?.defaultRole ?? '',
    sessionDays: Math.max(1, Math.round((s?.sessionDuration ?? 604800) / 86400)),
    minLength: s?.passwordPolicy?.minLength ?? 8,
  };
}

function toPayload(f: FormState): AppSecurity {
  const roles = f.roles.split(',').map((r) => r.trim()).filter(Boolean);
  return {
    enabled: f.enabled,
    authProviders: [...f.providers].map((provider) => ({ provider })),
    allowSignup: f.allowSignup,
    requireVerification: f.requireVerification,
    defaultAccess: f.defaultAccess,
    sessionDuration: f.sessionDays * 86400,
    ...(roles.length > 0 ? { roles } : {}),
    ...(f.defaultRole.trim() ? { defaultRole: f.defaultRole.trim() } : {}),
    passwordPolicy: { minLength: f.minLength },
  };
}

export default function SecurityAdmin({ appId, mode }: { appId: string; mode: AdminMode }) {
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await getSecurity(appId, mode);
    if (!res.ok) {
      setLoadError(res.error ?? 'Could not load security settings.');
      setForm(null);
    } else {
      setForm(toForm(res.security));
    }
    setLoading(false);
  }, [appId, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    setSavedAt(null);
    const res = await saveSecurity(appId, mode, toPayload(form));
    setSaving(false);
    if (res.ok) setSavedAt(Date.now());
    else setSaveError(res.error ?? 'Save failed.');
  }

  if (loading) {
    return (
      <div className="p-4">
        <Spinner label="Loading security settings…" />
      </div>
    );
  }

  if (loadError || !form) {
    return (
      <div className="space-y-3 p-4">
        <ErrorBanner message={loadError ?? 'No settings available.'} />
        <button className={btn.outline} onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const toggleProvider = (p: AuthProvider) =>
    setForm((f) => {
      if (!f) return f;
      const providers = new Set(f.providers);
      if (providers.has(p)) providers.delete(p);
      else providers.add(p);
      return { ...f, providers };
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Saving redeploys the <strong>{mode}</strong> app so the change takes effect.
          {mode === 'preview'
            ? ' Preview demo data is reset on redeploy. Publish afterwards to push these settings live.'
            : ' Existing data is preserved.'}
        </div>

        {/* Master toggle */}
        <Row
          title="Authentication"
          desc="Require end-users to sign in. When off, the app is fully public regardless of the settings below."
        >
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} />
        </Row>

        <fieldset disabled={!form.enabled} className={form.enabled ? '' : 'opacity-50'}>
          <div className="space-y-5">
            <Row title="Login methods" desc="Which sign-in providers end-users can use.">
              <div className="flex flex-col gap-1.5">
                {PROVIDERS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm capitalize">
                    <input type="checkbox" checked={form.providers.has(p)} onChange={() => toggleProvider(p)} />
                    {p}
                  </label>
                ))}
              </div>
            </Row>

            <Row title="Allow sign-up" desc="Let new end-users self-register.">
              <Toggle checked={form.allowSignup} onChange={(v) => set('allowSignup', v)} />
            </Row>

            <Row title="Require email verification" desc="Users must verify their email before access.">
              <Toggle checked={form.requireVerification} onChange={(v) => set('requireVerification', v)} />
            </Row>

            <Row title="Default access" desc="Access level for pages and data without an explicit rule.">
              <select
                className={`${inputClass} w-full`}
                value={form.defaultAccess}
                onChange={(e) => set('defaultAccess', e.target.value as FormState['defaultAccess'])}
              >
                {ACCESS_LEVELS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Row>

            <Row title="Roles" desc="Comma-separated role names used by this app.">
              <input
                className={inputClass}
                value={form.roles}
                onChange={(e) => set('roles', e.target.value)}
                placeholder="admin, editor, viewer"
              />
            </Row>

            <Row title="Default role" desc="Role assigned to new users on sign-up.">
              <input
                className={inputClass}
                value={form.defaultRole}
                onChange={(e) => set('defaultRole', e.target.value)}
                placeholder="user"
              />
            </Row>

            <Row title="Session length (days)" desc="How long a login stays valid.">
              <input
                type="number"
                min={1}
                className={`${inputClass} w-28`}
                value={form.sessionDays}
                onChange={(e) => set('sessionDays', Math.max(1, parseInt(e.target.value || '1', 10)))}
              />
            </Row>

            <Row title="Min password length" desc="Minimum characters for the email provider.">
              <input
                type="number"
                min={1}
                className={`${inputClass} w-28`}
                value={form.minLength}
                onChange={(e) => set('minLength', Math.max(1, parseInt(e.target.value || '1', 10)))}
              />
            </Row>
          </div>
        </fieldset>

        {saveError && <ErrorBanner message={saveError} />}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
        {savedAt && <span className="text-xs text-green-600">Saved & redeployed.</span>}
        <button className={btn.outline} onClick={() => void load()} disabled={saving}>
          Reset
        </button>
        <button className={btn.primary} onClick={save} disabled={saving}>
          {saving ? 'Applying…' : 'Save & redeploy'}
        </button>
      </div>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <div className="w-full sm:w-auto sm:min-w-[12rem]">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
