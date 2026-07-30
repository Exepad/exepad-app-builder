import { useEffect, useState, type FormEvent } from 'react';
import { Cpu, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  KEY_PLACEHOLDER,
  MODEL_PLACEHOLDER,
  PROVIDERS,
  SELECT_CLASS,
  providerMeta,
} from '@/components/settings/llm-providers';
import { getProviderModels, saveSettings, type ProviderModel } from '@/services/StudioStream';

/**
 * Shown in the studio's preview pane when no AI provider key is configured.
 *
 * Without a key the agent cannot build anything, so the studio's empty state
 * ("Your preview will appear here.") was telling the user to wait for something
 * that could never arrive: typing a prompt ran a build that planned, failed
 * several steps deep, and reported "the agent reported a failure" — which names
 * neither the key nor the fix. The one thing standing between them and a working
 * studio is a provider, so ask for it right here rather than sending them off to
 * find Settings.
 *
 * This is the SAME form as the Settings page's "AI engine (LLM)" card — every
 * provider, not just OpenRouter — because a first-run gate that quietly assumes
 * OpenRouter is worse than no gate for anyone holding a Gemini or Anthropic key.
 * The catalogue is shared (components/settings/llm-providers) so the two cannot
 * drift.
 */
export function LlmKeyGate({ onSaved }: { onSaved: () => void }) {
  const [provider, setProvider] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = providerMeta(provider);

  // Mirrors SettingsPage: the OpenRouter catalogue powers the model datalist.
  useEffect(() => {
    if (provider !== 'openrouter') {
      setModels([]);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    (async () => {
      const list = await getProviderModels('openrouter');
      if (cancelled) return;
      setModels(list);
      setModelsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // A custom OpenAI-compatible endpoint is useless without its URL, and some of
  // them accept any key at all — so the URL is what gates Save for that one.
  const canSave = meta.needsBaseUrl
    ? Boolean(baseUrl.trim()) && Boolean(apiKey.trim())
    : Boolean(apiKey.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    // Only send what the user actually filled in: a blank model must stay blank
    // so the provider's own default applies, rather than being pinned to ''.
    const llm: { provider: string; apiKey: string; model?: string; baseUrl?: string } = {
      provider,
      apiKey: apiKey.trim(),
    };
    if (model.trim()) llm.model = model.trim();
    if (meta.needsBaseUrl && baseUrl.trim()) llm.baseUrl = baseUrl.trim();

    const { ok, error: err } = await saveSettings({ llm });
    setSaving(false);
    if (!ok) {
      setError(err || 'Could not save. Please check the key and try again.');
      return;
    }
    setApiKey('');
    onSaved();
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md border border-border bg-muted">
            <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Add your AI provider key</h2>
            <p className="text-xs text-muted-foreground">
              The model the agent uses to plan and build apps.
            </p>
          </div>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          Exepad builds your apps with your own AI account, so you pay the provider directly.
          Everything here can be changed later in Settings.
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gate-provider">Provider</Label>
            <select
              id="gate-provider"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setError(null);
              }}
              className={SELECT_CLASS}
              disabled={saving}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{meta.hint}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gate-api-key">API key</Label>
            <Input
              id="gate-api-key"
              // Not type="password": this is the user's own key on their own
              // machine, and masking makes a mistyped paste impossible to spot.
              type="text"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="font-mono text-sm"
              placeholder={KEY_PLACEHOLDER[provider] ?? 'your API key'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'gate-error' : undefined}
              disabled={saving}
            />
            {meta.keyUrl && (
              <p className="text-xs text-muted-foreground">
                Create one at{' '}
                <a
                  href={meta.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {meta.keyUrlLabel}
                </a>
                .
              </p>
            )}
          </div>

          {meta.needsBaseUrl && (
            <div className="space-y-1.5">
              <Label htmlFor="gate-base-url">Base URL</Label>
              <Input
                id="gate-base-url"
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                The OpenAI-compatible endpoint of your local or self-hosted model server.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="gate-model">
              Model{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {provider === 'openrouter' && modelsLoading ? '(loading…)' : '(optional)'}
              </span>
            </Label>
            <Input
              id="gate-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list={provider === 'openrouter' ? 'gate-openrouter-models' : undefined}
              placeholder={MODEL_PLACEHOLDER[provider] ?? 'model name'}
              disabled={saving}
            />
            {provider === 'openrouter' && models.length > 0 && (
              <datalist id="gate-openrouter-models">
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

          {error && (
            <p id="gate-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!canSave || saving}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save and start building'}
          </Button>
        </form>
      </div>
    </div>
  );
}
