/**
 * App addresses — the per-app subdomain list shown when a wildcard custom domain is
 * active. Each published app answers at `<alias>.<base>`; the operator can rename an
 * app's alias (its subdomain label) inline. Backed by GET /api/orchestrate/apps
 * (carries the slug) + POST /api/orchestrate/apps/:id/alias.
 */
import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listApps, renameAppAlias, type StudioApp } from '@/services/StudioStream';

export default function AppAddresses({ base }: { base: string }) {
  const [apps, setApps] = useState<StudioApp[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setApps(await listApps());
  }
  useEffect(() => {
    void load();
  }, []);

  if (apps === null) return null;
  const published = apps.filter((a) => a.status === 'published' || a.publishedAt);

  async function save(appId: string) {
    setBusy(true);
    setErr(null);
    const r = await renameAppAlias(appId, draft.trim());
    setBusy(false);
    if (!r.ok) {
      setErr(r.error ?? 'Could not rename the alias.');
      return;
    }
    setEditing(null);
    await load();
  }

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">App addresses</h3>
        <p className="text-xs text-muted-foreground">
          Each published app answers at its alias. Rename an alias to change its URL.
        </p>
      </div>

      {published.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
          No published apps yet — publish one and it appears here at{' '}
          <span className="font-mono">{`<app>.${base}`}</span>.
        </p>
      ) : (
        <div className="divide-y rounded-xl border">
          {published.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <span className="w-28 shrink-0 truncate text-sm font-medium" title={a.name}>
                {a.name}
              </span>
              {editing === a.id ? (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className="h-8 max-w-[10rem] font-mono text-xs"
                    spellCheck={false}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draft.trim()) void save(a.id);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <span className="font-mono text-xs text-muted-foreground">.{base}</span>
                  <Button size="sm" className="h-8" disabled={busy || !draft.trim()} onClick={() => save(a.id)}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <a
                    href={`https://${a.slug}.${base}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate font-mono text-xs text-foreground hover:underline"
                  >
                    {a.slug}
                    <span className="text-muted-foreground">.{base}</span>
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => {
                      setEditing(a.id);
                      setDraft(a.slug);
                      setErr(null);
                    }}
                  >
                    Rename
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </section>
  );
}
