/**
 * Per-app custom domains — the app-scoped counterpart to the platform-level Access
 * & Domains tab. Rendered inside an app's Publish panel (StudioPage), it lets the
 * operator point a domain (or subdomain) at THIS app so it answers at the host root
 * (e.g. crm.example.com → this app), distinct from the platform domain that serves
 * the whole studio.
 *
 * A per-app domain is always a real hostname on the automatic (HTTP-01) TLS mode —
 * wildcards (which serve one app per subdomain, un-pinnable) and bare IPs belong to
 * the platform tab, so they're rejected here. Added domains show their DNS records +
 * live verification inline via the shared DomainRow.
 *
 * Backend: POST /api/domains { domain, appId, mode:'auto' } + the usual verify/remove.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { createDomain, listDomains, type CustomDomain } from '@/services/StudioStream';
import DomainRow from './DomainRow';
import { checkDomain, cleanHostInput } from './domain-input';

export default function AppDomainSection({ appId, published }: { appId: string; published: boolean }) {
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await listDomains();
    // Only the domains pinned to THIS app (app_id === appId); the platform domain
    // and other apps' domains live in the platform tab.
    if (data) setDomains(data.domains.filter((d) => d.appId === appId));
    setLoading(false);
  }, [appId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await listDomains();
      if (cancelled) return;
      if (data) setDomains(data.domains.filter((d) => d.appId === appId));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  // Validate: a per-app domain must be a plain hostname (auto/HTTP-01). Reject a
  // wildcard or a bare IP with actionable copy — those are platform-tab concepts.
  const cleaned = cleanHostInput(value);
  const check = checkDomain(cleaned, { allowWildcard: true });
  let localError: string | null = null;
  if (cleaned) {
    if (check.kind === 'ip') localError = 'A bare IP is a platform-level free link — set it in Settings → Access & Domains.';
    else if (check.kind === 'wildcard') localError = 'A wildcard serves one app per subdomain — add it in Settings → Access & Domains.';
    else if (check.kind !== 'ok') localError = 'Enter a valid domain, e.g. app.example.com.';
  }
  const canAdd = check.kind === 'ok' && !busy;

  async function add() {
    if (check.kind !== 'ok') return;
    setBusy(true);
    setError(null);
    const r = await createDomain({ target: 'domain', domain: check.value, appId, mode: 'auto' });
    setBusy(false);
    if (r.ok && r.domain) {
      setValue('');
      setJustAdded(r.domain.domain);
      await refresh();
    } else {
      setError(r.error ?? 'Could not add the domain.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canAdd) {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="app.example.com"
          spellCheck={false}
          autoCapitalize="off"
          disabled={busy}
          className="font-mono text-xs"
        />
        <Button type="button" size="sm" onClick={add} disabled={!canAdd}>
          <Plus className="size-3.5" /> {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>

      {cleaned && !localError && !error && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono text-foreground">https://{cleaned}</span> will serve this app, with an
          automatic browser-trusted certificate.
        </p>
      )}
      <p className={cn('text-[11px] text-destructive', !(localError || error) && 'hidden')}>{localError || error}</p>

      {!published && (
        <p className="text-[11px] text-muted-foreground">
          Publish this app to your instance first — the domain serves the published build.
        </p>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : domains.length > 0 ? (
        <div className="space-y-2">
          {domains.map((d) => (
            <DomainRow
              key={d.domain}
              domain={d}
              onChanged={refresh}
              hideTarget
              defaultExpanded={d.domain === justAdded}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
