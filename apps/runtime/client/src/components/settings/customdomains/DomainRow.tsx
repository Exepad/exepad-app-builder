/**
 * One registered-domain row with an expandable detail panel — shared by the
 * platform-level Access & Domains list (CustomDomainsSettings) and the per-app
 * domain list in an app's Publish panel (AppDomainSection).
 *
 * Active domains show their live URL; pending ones show the DNS records to create
 * with live status pills (DnsRecordSignals), a "Verify now" action, and Remove.
 * The row is presentational + self-contained: it calls verify/patch/remove itself
 * and notifies the parent via onChanged so it can refetch the list.
 */
import { useState } from 'react';
import { Globe, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { patchDomain, removeDomain, verifyDomain, type CustomDomain } from '@/services/StudioStream';
import DnsRecordSignals from './DnsRecordSignals';
import { StatusBadge } from './StatusBadge';

const MODE_LABELS: Record<string, string> = {
  auto: 'Automatic HTTPS',
  dns: 'Per-app subdomains (DNS-01)',
  sslip: 'Free IP-based address',
  byoc: 'Your own certificate',
};

/** Plain-language method label for a domain row (routing beats mode). */
export function methodLabel(domain: CustomDomain): string {
  if (domain.routing === 'proxied') return 'Your proxy handles HTTPS';
  return MODE_LABELS[domain.mode] ?? domain.mode;
}

export default function DomainRow({
  domain,
  onChanged,
  defaultExpanded,
  /** Hide the "→ Whole studio / app name" target chip (redundant in a per-app list). */
  hideTarget,
}: {
  domain: CustomDomain;
  onChanged: () => void;
  defaultExpanded?: boolean;
  hideTarget?: boolean;
}) {
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function doVerify() {
    setBusy(true);
    setMsg(null);
    const r = await verifyDomain(domain.domain);
    setBusy(false);
    setMsg(r.verified ? 'Verified — now active.' : r.error || 'Not verified yet.');
    onChanged();
  }
  async function doRemove() {
    if (!confirm(`Remove ${domain.domain}? Its certificate stops being served.`)) return;
    setBusy(true);
    await removeDomain(domain.domain);
    setBusy(false);
    onChanged();
  }
  async function toggleHsts() {
    setBusy(true);
    await patchDomain(domain.domain, { hsts: !domain.hsts });
    setBusy(false);
    onChanged();
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <Globe className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm">{domain.domain}</span>
        {!hideTarget && <span className="text-xs text-muted-foreground">→ {domain.mapsTo}</span>}
        <span className="hidden text-xs text-muted-foreground sm:inline">{methodLabel(domain)}</span>
        <span className="ml-auto flex items-center gap-2">
          <StatusBadge status={domain.status} />
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </span>
      </div>

      {expanded && (
        <>
          <Separator />
          <div className="space-y-3 px-3 py-3">
            {domain.status === 'active' ? (
              <p className="text-sm">
                Live URL:{' '}
                <a className="text-primary hover:underline" href={domain.liveUrl} target="_blank" rel="noreferrer">
                  {domain.liveUrl}
                </a>
              </p>
            ) : (
              <DnsRecordSignals domain={domain.domain} records={domain.dnsRecords} enabled={expanded} />
            )}

            {domain.lastError && domain.status !== 'active' && (
              <p className="text-xs text-destructive">{domain.lastError}</p>
            )}
            {msg && <p className="text-xs text-muted-foreground">{msg}</p>}

            <div className="flex flex-wrap items-center gap-2">
              {domain.status !== 'active' && (
                <Button type="button" size="sm" variant="outline" onClick={doVerify} disabled={busy}>
                  {busy ? 'Verifying…' : 'Verify now'}
                </Button>
              )}
              {domain.status === 'active' && (
                <Button type="button" size="sm" variant="ghost" onClick={toggleHsts} disabled={busy}>
                  {domain.hsts ? 'Disable HSTS' : 'Enable HSTS'}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={doRemove}
                disabled={busy}
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            </div>
            {domain.status === 'active' && !domain.hsts && (
              <p className="text-xs text-muted-foreground">
                HSTS is off (recommended). Enabling can lock users out if you later lose the certificate.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
