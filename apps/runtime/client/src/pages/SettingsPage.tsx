import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useOutletContext } from 'react-router';
import { Cpu, Globe, Image as ImageIcon, type LucideIcon } from 'lucide-react';
import {
  getProviderModels,
  getSettings,
  saveSettings,
  type ImageProvider,
  type ProviderModel,
  type SecretView,
  type StudioSettings,
} from '../services/StudioStream';
import type { StudioOutletContext } from '@/components/studio/StudioShell';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import CustomDomainsSettings from '@/components/settings/CustomDomainsSettings';
import UpdateBanner from '@/components/settings/UpdateBanner';

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

const PROVIDERS: Array<{ value: string; label: string; needsBaseUrl?: boolean; hint: string }> = [
  { value: 'openrouter', label: 'OpenRouter', hint: 'One key, hundreds of models. Recommended.' },
  { value: 'gemini', label: 'Google Gemini', hint: 'Native Gemini API key.' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude models (sk-ant-…).' },
  { value: 'openai', label: 'OpenAI', hint: 'GPT models (sk-…).' },
  {
    value: 'custom',
    label: 'Custom (OpenAI-compatible)',
    needsBaseUrl: true,
    hint: 'Ollama / vLLM / LM Studio / any OpenAI-compatible endpoint.',
  },
];

const MODEL_PLACEHOLDER: Record<string, string> = {
  openrouter: 'e.g. anthropic/claude-3.5-sonnet',
  gemini: 'e.g. gemini-3-flash-preview',
  anthropic: 'e.g. claude-3-5-sonnet-latest',
  openai: 'e.g. gpt-4o',
  custom: 'e.g. llama3.1:70b',
};

type SectionId = 'ai' | 'images' | 'domains';

const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon; blurb: string }> = [
  { id: 'ai', label: 'AI engine', icon: Cpu, blurb: 'Model & provider' },
  { id: 'images', label: 'Stock images', icon: ImageIcon, blurb: 'AI URLs + photo source' },
  { id: 'domains', label: 'Access & Domains', icon: Globe, blurb: 'Your domain + HTTPS' },
];

// ── Stock-image providers (exactly one active at a time) ─────────────────────
// Openverse is keyless (the default, and the agent's silent last-resort
// fallback); the other three are free but need a key. `keyState` names the
// per-provider key input this card reveals when selected.
interface ImageProviderMeta {
  value: ImageProvider;
  label: string;
  tagline: string;
  badge: string;
  keyState?: 'pexels' | 'unsplash' | 'pixabay';
  keyLabel?: string;
  help?: ReactNode;
}

const IMAGE_PROVIDER_META: ImageProviderMeta[] = [
  {
    value: 'openverse',
    label: 'Openverse',
    tagline: 'Creative-Commons images, no key required.',
    badge: 'No key needed',
  },
  {
    value: 'pexels',
    label: 'Pexels',
    tagline: 'Free stock photos, commercial-use license.',
    badge: 'Free API key',
    keyState: 'pexels',
    keyLabel: 'Pexels API key',
    help: (
      <>
        Create one at{' '}
        <a
          href="https://www.pexels.com/api/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          pexels.com/api
        </a>
        .
      </>
    ),
  },
  {
    value: 'unsplash',
    label: 'Unsplash',
    tagline: 'High-quality photography, hotlinked per their guidelines.',
    badge: 'Free API key',
    keyState: 'unsplash',
    keyLabel: 'Unsplash API key',
    help: (
      <>
        Use your Unsplash app <span className="font-medium">Access Key</span> from{' '}
        <a
          href="https://unsplash.com/oauth/applications"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          unsplash.com/developers
        </a>
        .
      </>
    ),
  },
  {
    value: 'pixabay',
    label: 'Pixabay',
    tagline: 'Free photos & illustrations, no attribution required.',
    badge: 'Free API key',
    keyState: 'pixabay',
    keyLabel: 'Pixabay API key',
    help: (
      <>
        Create one at{' '}
        <a
          href="https://pixabay.com/api/docs/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          pixabay.com/api
        </a>
        .
      </>
    ),
  },
];

/** Dependency-free active/inactive toggle slider (native switch semantics). */
function ProviderSwitch({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function SecretStatus({ secret }: { secret: SecretView }) {
  if (!secret.set) {
    return <span className="text-xs text-muted-foreground">Not set</span>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      Set {secret.hint} {secret.source === 'env' && '(from environment)'}
    </span>
  );
}

export default function SettingsPage() {
  useOutletContext<StudioOutletContext>(); // shell provides the auth guard
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<SectionId>('ai');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Form state.
  const [provider, setProvider] = useState('openrouter');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [imageProvider, setImageProvider] = useState<ImageProvider>('openverse');
  const [useLlmImageUrls, setUseLlmImageUrls] = useState(true);
  const [pexelsKey, setPexelsKey] = useState('');
  const [unsplashKey, setUnsplashKey] = useState('');
  const [pixabayKey, setPixabayKey] = useState('');

  // Server-reported secret status (so we don't have to echo the key).
  const [llmKeyStatus, setLlmKeyStatus] = useState<SecretView | null>(null);
  const [pexelsStatus, setPexelsStatus] = useState<SecretView | null>(null);
  const [unsplashStatus, setUnsplashStatus] = useState<SecretView | null>(null);
  const [pixabayStatus, setPixabayStatus] = useState<SecretView | null>(null);

  // Each keyed provider's card/field ↔ its own key input + server status.
  const keyBindings: Record<
    'pexels' | 'unsplash' | 'pixabay',
    { value: string; set: (v: string) => void; status: SecretView | null }
  > = {
    pexels: { value: pexelsKey, set: setPexelsKey, status: pexelsStatus },
    unsplash: { value: unsplashKey, set: setUnsplashKey, status: unsplashStatus },
    pixabay: { value: pixabayKey, set: setPixabayKey, status: pixabayStatus },
  };

  /** A keyed provider counts as "has a key" if one is stored OR freshly typed. */
  function providerHasKey(keyState: 'pexels' | 'unsplash' | 'pixabay'): boolean {
    const b = keyBindings[keyState];
    return Boolean(b.status?.set) || b.value.trim().length > 0;
  }

  /** Activate a provider (exactly one active); toggling the active one off
   *  falls back to the keyless Openverse default so a source is always on. */
  function toggleImageProvider(value: ImageProvider) {
    setImageProvider((cur) => (cur === value ? 'openverse' : value));
    setMessage(null);
  }

  // OpenRouter model catalogue.
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await getSettings();
      if (cancelled) return;
      if (settings) applyServerSettings(settings);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyServerSettings(s: StudioSettings) {
    setProvider(s.llm.provider || 'openrouter');
    setModel(s.llm.model || '');
    setBaseUrl(s.llm.baseUrl || '');
    setLlmKeyStatus(s.llm.apiKey);
    setImageProvider(s.images.provider || 'openverse');
    setUseLlmImageUrls(s.images.keepLlmUrls !== false);
    setPexelsStatus(s.images.pexels.apiKey);
    setUnsplashStatus(s.images.unsplash.apiKey);
    setPixabayStatus(s.images.pixabay.apiKey);
  }

  // Load the OpenRouter catalogue when that provider is selected.
  useEffect(() => {
    if (provider !== 'openrouter') {
      setModels([]);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    (async () => {
      const list = await getProviderModels('openrouter');
      if (!cancelled) {
        setModels(list);
        setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const selectedProvider = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;

    // An active keyed provider requires its API key. Openverse never does.
    const activeMeta = IMAGE_PROVIDER_META.find((m) => m.value === imageProvider);
    if (activeMeta?.keyState && !providerHasKey(activeMeta.keyState)) {
      setMessage({
        kind: 'error',
        text: `Enter a ${activeMeta.label} API key — it's required while ${activeMeta.label} is the active provider.`,
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    // Single active provider: send the selection, and only the SELECTED
    // provider's key (if the operator entered one). Keys for the other
    // providers stay as-is in the store but are never sent to the agent.
    const result = await saveSettings({
      llm: {
        provider,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
        // Empty = keep the existing key (server treats empty as no-change).
        apiKey: apiKey.trim() || undefined,
      },
      images: {
        provider: imageProvider,
        keepLlmUrls: useLlmImageUrls,
        ...(imageProvider === 'pexels'
          ? { pexels: { apiKey: pexelsKey.trim() || undefined } }
          : {}),
        ...(imageProvider === 'unsplash'
          ? { unsplash: { apiKey: unsplashKey.trim() || undefined } }
          : {}),
        ...(imageProvider === 'pixabay'
          ? { pixabay: { apiKey: pixabayKey.trim() || undefined } }
          : {}),
      },
    });

    setSaving(false);
    if (result.ok) {
      setApiKey('');
      setPexelsKey('');
      setUnsplashKey('');
      setPixabayKey('');
      setMessage({ kind: 'ok', text: 'Settings saved. They apply on your next build.' });
      const refreshed = await getSettings();
      if (refreshed) applyServerSettings(refreshed);
    } else {
      setMessage({ kind: 'error', text: result.error || 'Could not save settings.' });
    }
  }

  // ── AI engine panel ─────────────────────────────────────────────────────────
  const aiPanel = (
    <Card>
      <CardHeader>
        <CardTitle>AI engine (LLM)</CardTitle>
        <CardDescription>The model the agent uses to plan and build apps.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="provider">Provider</Label>
          <select
            id="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className={SELECT_CLASS}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{selectedProvider.hint}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Label htmlFor="apiKey">API key</Label>
            {llmKeyStatus && <SecretStatus secret={llmKeyStatus} />}
          </div>
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={llmKeyStatus?.set ? 'Enter a new key to replace the current one' : 'sk-or-…'}
            autoComplete="off"
          />
          {provider === 'openrouter' && (
            <p className="text-xs text-muted-foreground">
              Create one at{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                openrouter.ai/keys
              </a>
              .
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="model">
            Model{' '}
            {provider === 'openrouter' && modelsLoading && (
              <span className="text-xs font-normal text-muted-foreground">(loading…)</span>
            )}
          </Label>
          <Input
            id="model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list={provider === 'openrouter' ? 'openrouter-models' : undefined}
            placeholder={MODEL_PLACEHOLDER[provider] ?? 'model name'}
          />
          {provider === 'openrouter' && models.length > 0 && (
            <datalist id="openrouter-models">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.contextLength ? ` — ${Math.round(m.contextLength / 1000)}k ctx` : ''}
                </option>
              ))}
            </datalist>
          )}
          <p className="text-xs text-muted-foreground">
            {provider === 'openrouter'
              ? 'Start typing to search the OpenRouter catalogue, or paste any model id.'
              : 'Leave blank to use the provider default.'}
          </p>
        </div>

        {selectedProvider.needsBaseUrl && (
          <div className="space-y-1.5">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
            />
            <p className="text-xs text-muted-foreground">
              The OpenAI-compatible endpoint of your local or self-hosted model server.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // ── Stock images panel ──────────────────────────────────────────────────────
  // Boxes with an active/inactive slider — exactly one provider is active at a
  // time. Openverse is the keyless default; turning a keyed provider ON expands
  // its box with the required API-key field. `keyBindings` / `toggleImageProvider`
  // / `providerHasKey` (defined above) drive selection, the field, and validation.
  const imagesPanel = (
    <Card>
      <CardHeader>
        <CardTitle>Images in generated apps</CardTitle>
        <CardDescription>
          Choose where the photos in generated apps come from: keep the image URLs the AI suggests, and pick the
          stock-photo library used to fill the rest. Openverse is on by default and needs no key; any other provider
          needs its own free API key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* AI-suggested image URLs — top-level yes/no. Default on. */}
        <div
          className={cn(
            'rounded-lg border p-3 transition-colors',
            useLlmImageUrls ? 'border-primary/60 bg-primary/5' : 'border-input',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Let the AI pick image URLs</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Default on
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {useLlmImageUrls
                  ? 'On — generated apps keep the image URLs the AI suggests. The stock source below fills any image the AI leaves blank or gets wrong.'
                  : 'Off — the AI’s suggested image URLs are discarded and every photo is sourced from the stock library below.'}
              </p>
            </div>
            <ProviderSwitch
              checked={useLlmImageUrls}
              onToggle={() => {
                setUseLlmImageUrls((v) => !v);
                setMessage(null);
              }}
              label="Let the AI pick image URLs"
            />
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="pt-1">
            <p className="text-sm font-medium">Stock image source</p>
            <p className="text-xs text-muted-foreground">
              The library the agent searches for real photos — the fallback when the AI leaves an image blank, and the
              sole source when the toggle above is off. Exactly one is active at a time.
            </p>
          </div>

          {IMAGE_PROVIDER_META.map((meta) => {
          const active = imageProvider === meta.value;
          const binding = meta.keyState ? keyBindings[meta.keyState] : null;
          const missingKey = active && !!meta.keyState && !providerHasKey(meta.keyState);
          return (
            <div
              key={meta.value}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                active ? 'border-primary/60 bg-primary/5' : 'border-input',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                        meta.keyState
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {meta.badge}
                    </span>
                    {active && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{meta.tagline}</p>
                </div>
                <ProviderSwitch
                  checked={active}
                  onToggle={() => toggleImageProvider(meta.value)}
                  label={`Activate ${meta.label}`}
                />
              </div>

              {active && binding && (
                <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <Label htmlFor="imageKey">
                      {meta.keyLabel} <span className="font-normal text-destructive">(required)</span>
                    </Label>
                    {binding.status && <SecretStatus secret={binding.status} />}
                  </div>
                  <Input
                    id="imageKey"
                    type="password"
                    value={binding.value}
                    onChange={(e) => binding.set(e.target.value)}
                    placeholder={
                      binding.status?.set
                        ? 'Enter a new key to replace the current one'
                        : `${meta.label} API key`
                    }
                    aria-invalid={missingKey || undefined}
                    className={missingKey ? 'border-destructive focus-visible:ring-destructive/40' : undefined}
                    autoComplete="off"
                  />
                  {meta.help && <p className="text-xs text-muted-foreground">{meta.help}</p>}
                </div>
              )}

              {active && !meta.keyState && (
                <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  No key needed — Openverse searches Creative-Commons imagery and is ready to use. Attribution (creator
                  + license) is stored on each image.
                </p>
              )}
            </div>
          );
        })}

          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Whichever provider is active, keyless <span className="font-medium text-foreground">Openverse</span> stays
            on as a last-resort fallback — if your provider returns nothing for an image, Openverse fills the gap so
            slots are never left blank.
          </p>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure this instance. Values are stored locally and override any environment variables.
        </p>
      </div>

      <UpdateBanner />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-6 md:flex-row">
          {/* Left navigation */}
          <nav className="shrink-0 md:w-56">
            <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5">
              {SECTIONS.map(({ id, label, icon: Icon, blurb }) => {
                const active = section === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setSection(id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                        active
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="flex flex-col">
                        <span className="text-sm">{label}</span>
                        <span className="hidden text-[11px] text-muted-foreground md:inline">{blurb}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {section === 'domains' ? (
              <CustomDomainsSettings />
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {section === 'ai' && aiPanel}
                {section === 'images' && imagesPanel}
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save settings'}
                  </Button>
                  {message && (
                    <span
                      className={cn(
                        'text-sm',
                        message.kind === 'ok' ? 'text-muted-foreground' : 'text-destructive',
                      )}
                    >
                      {message.text}
                    </span>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
