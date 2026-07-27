/**
 * Access — one screen for every way people reach this studio (replaces the old
 * Server & network + Domains & HTTPS tabs). It:
 *   1. Auto-detects the setup — a public server (routable IP) or behind a router/NAT.
 *   2. Lists the coexisting ways in, grouped by kind:
 *        · Custom domains — add, verify DNS, per-app subdomains (`*.yourdomain`).
 *        · This server's IP — the browser-trusted sslip link, plus a toggle to ALSO
 *          serve the raw IP directly (for a LAN/offline box). The domain and the IP
 *          work at the SAME time — this is not an either/or.
 *   3. Advanced — the studio/apps ports, DNS-target detection, and (on a public box)
 *      the Quick Access tunnel. Behind a NAT, Quick Access is promoted to the top.
 * Boot-bound settings (ports, IP access) surface ONE screen-level restart banner.
 *
 * Credentialed-CORS trust is automatic (same-origin + verified domains), so there's no
 * manual allowlist UI. Data: listDomains() → { domains, instance } and getNetworkConfig()
 * → NetworkConfig. Backend: /api/domains + /api/network + /api/quick-access + /api/orchestrate/apps.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Router, Server } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  createDomain,
  getNetworkConfig,
  listDomains,
  removeDomain,
  type CustomDomain,
  type DomainsInstance,
  type NetworkConfig,
} from '@/services/StudioStream';
import DomainRow from './customdomains/DomainRow';
import AddPlatformDomain from './customdomains/AddPlatformDomain';
import AppAddresses from './customdomains/AppAddresses';
import QuickAccessCard from './customdomains/QuickAccessCard';
import {
  IpAccessSection,
  PendingRestartBanner,
  PublicAddressCard,
  ServerSection,
} from './NetworkingSections';

/** Is this box behind a router (no directly-reachable public IP)? */
function isBehindRouter(instance: DomainsInstance | null): boolean {
  if (!instance) return false;
  return instance.dnsTargetSource === 'detected' || !instance.publiclyRoutable;
}

/** A compact on/off switch (no shadcn Switch in this project). */
function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label className={cn('relative inline-flex h-6 w-10 shrink-0', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="absolute inset-0 rounded-full bg-muted-foreground/30 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground" />
      <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
    </label>
  );
}

// ─── Auto-detected setup banner (public server vs behind a router) ───────────────

function SetupBanner({
  instance,
  onRecheck,
  rechecking,
}: {
  instance: DomainsInstance | null;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const nat = isBehindRouter(instance);
  const ip = instance?.dnsTargetType === 'A' ? instance?.dnsTarget : null;
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-xl border px-4 py-3',
        nat
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-emerald-500/30 bg-emerald-500/[0.06]',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
            nat
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
          )}
        >
          {nat ? <Router className="size-4" /> : <Server className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{nat ? 'Behind a router' : 'Public server'}</p>
          <p className="text-xs text-muted-foreground">
            {nat ? (
              'This machine isn’t directly reachable from the internet. Use a Quick Access link, or a domain with port-forwarding.'
            ) : ip ? (
              <>
                Reachable from the internet at <span className="font-mono text-foreground">{ip}</span>.
              </>
            ) : (
              'Reachable from the internet.'
            )}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRecheck}
        disabled={rechecking}
        className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
        title="Re-detect this server’s reachability"
      >
        <RefreshCw className={cn('size-3', rechecking && 'animate-spin')} />
        Re-check
      </button>
    </div>
  );
}

// ─── Per-app subdomains toggle (adds/removes the *.yourdomain wildcard) ──────────

function PerAppToggle({
  apex,
  wildcardRow,
  onChanged,
}: {
  apex: string;
  wildcardRow: CustomDomain | undefined;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const on = Boolean(wildcardRow);

  async function toggle(next: boolean) {
    setBusy(true);
    setErr(null);
    const r = next
      ? await createDomain({ target: 'domain', domain: `*.${apex}`, mode: 'auto' })
      : wildcardRow
        ? await removeDomain(wildcardRow.domain)
        : { ok: true as const };
    setBusy(false);
    if (!r.ok) {
      setErr(('error' in r && r.error) || 'Could not update per-app subdomains.');
      return;
    }
    await onChanged();
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3">
      <div className="flex-1">
        <p className="text-sm font-medium">Give each published app its own address</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Published apps answer at <span className="font-mono">{`<app>.${apex}`}</span>, using each app's alias.
          New apps get one automatically when you publish. Adds a wildcard{' '}
          <span className="font-mono">{`*.${apex}`}</span> DNS record (shown below until verified).
        </p>
        {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      </div>
      <Switch checked={on} disabled={busy} onChange={toggle} label="Per-app subdomains" />
    </div>
  );
}

// ─── Custom-domains group ────────────────────────────────────────────────────────

function DomainsSection({
  loading,
  studioRows,
  studioApex,
  wildcardRow,
  activeWildcardBase,
  justAdded,
  onDomainAdded,
  reloadAll,
  needsPortForward,
}: {
  loading: boolean;
  studioRows: CustomDomain[];
  studioApex: CustomDomain | undefined;
  wildcardRow: CustomDomain | undefined;
  activeWildcardBase: string | null;
  justAdded: string | null;
  onDomainAdded: (domain: string) => Promise<void>;
  reloadAll: () => Promise<void>;
  needsPortForward: boolean;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Custom domains</h3>
        <p className="text-xs text-muted-foreground">
          Serve the studio and apps at your own domain with an automatic browser-trusted certificate.
          {needsPortForward && ' You’ll also need to forward ports 80 and 443 to this machine.'}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {studioRows.map((d) => (
            <DomainRow key={d.domain} domain={d} onChanged={reloadAll} defaultExpanded={d.domain === justAdded} />
          ))}
          {!studioApex && <AddPlatformDomain onAdded={onDomainAdded} />}
          {studioApex && (
            <>
              <PerAppToggle apex={studioApex.domain} wildcardRow={wildcardRow} onChanged={reloadAll} />
              {wildcardRow && (
                <DomainRow domain={wildcardRow} onChanged={reloadAll} defaultExpanded={wildcardRow.domain === justAdded} />
              )}
            </>
          )}
        </>
      )}

      {activeWildcardBase && <AppAddresses base={activeWildcardBase} />}
    </section>
  );
}

// ─── Advanced (ports, DNS-target detection, and — on a public box — Quick Access) ─

function AdvancedSection({
  network,
  netLoading,
  instance,
  reloadNetwork,
  recheck,
  rechecking,
  reloadAll,
  includeQuickAccess,
}: {
  network: NetworkConfig | null;
  netLoading: boolean;
  instance: DomainsInstance | null;
  reloadNetwork: () => Promise<void>;
  recheck: () => void;
  rechecking: boolean;
  reloadAll: () => Promise<void>;
  includeQuickAccess: boolean;
}) {
  return (
    <details className="rounded-xl border bg-card/40 open:bg-card/60">
      <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-semibold text-muted-foreground">
        Advanced
      </summary>
      <div className="space-y-5 border-t p-3.5">
        <div className="space-y-2">
          <div>
            <h4 className="text-sm font-semibold">Ports</h4>
            <p className="text-xs text-muted-foreground">
              The ports the studio and published apps are served on. A change applies after a restart.
            </p>
          </div>
          <ServerSection
            server={network?.server ?? null}
            netLoading={netLoading}
            onSaved={reloadNetwork}
            onRetry={reloadNetwork}
          />
        </div>

        <div className="space-y-2">
          <div>
            <h4 className="text-sm font-semibold">DNS target &amp; detection</h4>
            <p className="text-xs text-muted-foreground">
              The address this instance advertises for DNS — auto-detected, override if it looks wrong.
            </p>
          </div>
          <PublicAddressCard
            instance={instance}
            publicAddress={network?.publicAddress ?? null}
            netLoading={netLoading}
            onRecheck={recheck}
            rechecking={rechecking}
            onSaved={reloadAll}
          />
        </div>

        {includeQuickAccess && (
          <div className="space-y-2">
            <div>
              <h4 className="text-sm font-semibold">Quick Access tunnel</h4>
              <p className="text-xs text-muted-foreground">
                A temporary public link over Cloudflare — handy for a quick share without DNS.
              </p>
            </div>
            <QuickAccessCard />
          </div>
        )}
      </div>
    </details>
  );
}

// ─── Behind-a-router: promote getting a public address ───────────────────────────

function NatGetPublicAddress() {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Get a public address</h3>
        <p className="text-xs text-muted-foreground">
          This box isn’t reachable from the internet yet — start a Quick Access link for an instant
          public URL, or add a custom domain below and forward ports 80/443 from your router.
        </p>
      </div>
      <QuickAccessCard />
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────────

export default function CustomDomainsSettings() {
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [instance, setInstance] = useState<DomainsInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [network, setNetwork] = useState<NetworkConfig | null>(null);
  const [netLoading, setNetLoading] = useState(true);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await listDomains();
    if (data) {
      setDomains(data.domains);
      setInstance(data.instance);
    }
  }, []);

  const reloadNetwork = useCallback(async () => {
    const n = await getNetworkConfig();
    if (n) setNetwork(n);
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([refresh(), reloadNetwork()]);
  }, [refresh, reloadNetwork]);

  const recheck = useCallback(async () => {
    setRechecking(true);
    const data = await listDomains(true);
    if (data) {
      setDomains(data.domains);
      setInstance(data.instance);
    }
    await reloadNetwork();
    setRechecking(false);
  }, [reloadNetwork]);

  const onDomainAdded = useCallback(
    async (domain: string) => {
      setJustAdded(domain);
      await reloadAll();
    },
    [reloadAll],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, n] = await Promise.all([listDomains(), getNetworkConfig()]);
      if (cancelled) return;
      if (d) {
        setDomains(d.domains);
        setInstance(d.instance);
      }
      setNetwork(n);
      setLoading(false);
      setNetLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Categorize the operator's domain rows.
  const studioApex = domains.find((d) => d.appId === null && !d.domain.startsWith('*.'));
  const wildcardRow = domains.find((d) => d.domain.startsWith('*.'));
  const activeWildcardBase =
    wildcardRow && wildcardRow.status === 'active' ? wildcardRow.domain.slice(2) : null;
  const studioRows = domains.filter((d) => !d.domain.startsWith('*.'));
  const behindRouter = isBehindRouter(instance);

  const domainsSection = (
    <DomainsSection
      loading={loading}
      studioRows={studioRows}
      studioApex={studioApex}
      wildcardRow={wildcardRow}
      activeWildcardBase={activeWildcardBase}
      justAdded={justAdded}
      onDomainAdded={onDomainAdded}
      reloadAll={reloadAll}
      needsPortForward={behindRouter}
    />
  );

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">Access</h2>
          <p className="text-sm text-muted-foreground">How people reach this studio and its published apps.</p>
        </div>

        <SetupBanner instance={instance} onRecheck={recheck} rechecking={rechecking} />

        {/* Boot-bound changes (ports, IP access) → one restart-to-apply banner. */}
        <PendingRestartBanner server={network?.server ?? null} />

        {behindRouter ? (
          <>
            <NatGetPublicAddress />
            {domainsSection}
            <AdvancedSection
              network={network}
              netLoading={netLoading}
              instance={instance}
              reloadNetwork={reloadNetwork}
              recheck={recheck}
              rechecking={rechecking}
              reloadAll={reloadAll}
              includeQuickAccess={false}
            />
          </>
        ) : (
          <>
            {domainsSection}
            <IpAccessSection instance={instance} server={network?.server ?? null} onSaved={reloadAll} />
            <AdvancedSection
              network={network}
              netLoading={netLoading}
              instance={instance}
              reloadNetwork={reloadNetwork}
              recheck={recheck}
              rechecking={rechecking}
              reloadAll={reloadAll}
              includeQuickAccess
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
