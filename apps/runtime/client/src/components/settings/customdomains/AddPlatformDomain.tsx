/**
 * Add a PLATFORM-level custom domain (the whole studio), the lean replacement for
 * the old goal/topology wizard. One input accepts three shapes, and the TLS mode is
 * derived automatically (mirrors POST /api/domains' own rules):
 *
 *   example.com          → the whole studio at that domain      (mode 'auto', HTTP-01)
 *   *.example.com        → each app at its own subdomain, auto  (mode 'auto', per-subdomain HTTP-01)
 *   203.0.113.10         → a free browser-trusted IP link       (mode 'sslip')
 *
 * Per-app custom domains are NOT set here — an app gets its own address from its
 * publish settings, or automatically as <app>.<your-wildcard-domain>. So there is
 * no "which app" picker: a domain added here always maps to the whole studio.
 *
 * The added row then shows its DNS records + live verification inline (DomainRow →
 * DnsRecordSignals), so this form's only job is validate → create → hand back the
 * created host so the parent can reveal it.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { createDomain, type CreateDomainInput } from '@/services/StudioStream';
import { checkDomain, checkIp, isIpAddressInput, cleanHostInput, sslipPreview } from './domain-input';

/** Derive the create payload from a cleaned host, or an error string. */
function payloadFor(raw: string): { input: CreateDomainInput } | { error: string } | null {
  const host = cleanHostInput(raw);
  if (!host) return null; // empty — no error, just disabled
  if (isIpAddressInput(host)) {
    const ip = checkIp(host);
    if (ip.kind === 'private') {
      return { error: 'That’s a private/LAN IP — a public certificate can’t be issued for it.' };
    }
    if (ip.kind !== 'ok') return { error: 'Enter a valid public IPv4 address.' };
    return { input: { target: 'ip', ip: ip.value, mode: 'sslip' } };
  }
  const d = checkDomain(host, { allowWildcard: true });
  if (d.kind === 'invalid') return { error: 'Enter a valid domain, e.g. example.com or *.example.com.' };
  if (d.kind !== 'ok' && d.kind !== 'wildcard') return null; // empty
  const domain = d.value;
  // A domain (apex or wildcard) uses 'auto': the whole studio at an apex, or a
  // per-subdomain HTTP-01 cert issued on demand per published app for a wildcard —
  // works with ANY DNS provider (plain A record, no token). The one-cert DNS-01
  // wildcard path (mode 'dns', for behind-NAT / zero cold-start) stays available
  // via the API.
  return {
    input: { target: 'domain', domain, appId: null, mode: 'auto' },
  };
}

export default function AddPlatformDomain({ onAdded }: { onAdded: (domain: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derived = payloadFor(value);
  const localError = derived && 'error' in derived ? derived.error : null;
  const canAdd = Boolean(derived && 'input' in derived) && !busy;

  const cleaned = cleanHostInput(value);
  const isIp = Boolean(cleaned) && isIpAddressInput(cleaned);
  const isWildcard = cleaned.startsWith('*.');
  const sslip = isIp ? sslipPreview(cleaned) : null;

  async function add() {
    if (!derived || !('input' in derived)) return;
    setBusy(true);
    setError(null);
    const r = await createDomain(derived.input);
    setBusy(false);
    if (r.ok && r.domain) {
      setValue('');
      onAdded(r.domain.domain);
    } else {
      setError(r.error ?? 'Could not add the domain.');
    }
  }

  return (
    <div className="space-y-2">
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
          placeholder="example.com  ·  *.example.com  ·  203.0.113.10"
          spellCheck={false}
          autoCapitalize="off"
          disabled={busy}
          className="font-mono text-sm"
        />
        <Button type="button" size="sm" onClick={add} disabled={!canAdd}>
          <Plus className="size-4" /> {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>

      {/* What the entered value will do — reassurance before they commit. */}
      {cleaned && !localError && (
        <p className="text-[11px] text-muted-foreground">
          {isIp ? (
            <>
              Free browser-trusted link at{' '}
              <span className="font-mono text-foreground">{sslip ?? `${cleaned}.sslip.io`}</span> — no DNS setup.
            </>
          ) : isWildcard ? (
            <>
              Each app answers at its own subdomain automatically (e.g.{' '}
              <span className="font-mono text-foreground">crm.{cleaned.slice(2)}</span>), each with its own
              automatic browser-trusted certificate — any DNS provider, no token.
            </>
          ) : (
            <>
              The whole studio at{' '}
              <span className="font-mono text-foreground">https://{cleaned}</span>, with an automatic
              browser-trusted certificate.
            </>
          )}
        </p>
      )}

      <p className={cn('text-xs text-destructive', !(localError || error) && 'hidden')}>{localError || error}</p>
    </div>
  );
}
