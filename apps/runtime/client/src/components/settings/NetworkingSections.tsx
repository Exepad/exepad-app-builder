/**
 * Networking sections for the Access & Domains settings, distributed across tabs
 * by CustomDomainsSettings.tsx:
 *
 *   - PublicAddressCard      (Domains & HTTPS tab) — the ONE place the instance's
 *     advertised address is shown: the detected DNS target + Re-check, with the
 *     editable EXEPAD_PUBLIC_HOST / EXEPAD_PUBLIC_IP override tucked in a disclosure
 *     that opens itself only when detection looks wrong (behind a router).
 *   - ServerSection          (Server & network tab) — the editable studio FRONT port
 *     (the HTTPS port when TLS is in-process, else the HTTP port). It binds at
 *     startup, so a saved change applies on the next restart; the section flags the
 *     pending-restart diff and, behind a front TLS proxy, is read-only (the proxy
 *     owns the public port).
 *
 * Data (NetworkConfig) is fetched once by the parent and passed down; each section
 * degrades gracefully while it loads or if the fetch failed. The readout in
 * PublicAddressCard is driven by the always-present `instance` (from listDomains)
 * so the address never blanks out if getNetworkConfig hiccups; only the editable
 * override fields depend on NetworkConfig. Backend: /api/network.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Globe, Lock, RefreshCw, Server, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  putNetworkConfig,
  restartInstance,
  type DomainsInstance,
  type NetworkConfig,
  type NetworkUpdate,
  type NetSource,
} from '@/services/StudioStream';

/**
 * Ports web browsers refuse to open (ERR_UNSAFE_PORT) — well-known service ports
 * (6000 = X11, 22 = SSH, …). Binding one is legal but the studio would be
 * unreachable in a browser, so the port editor blocks them. Mirrors the worker's
 * BROWSER_UNSAFE_PORTS (net-config.ts) / Chromium's kRestrictedPorts.
 */
const BROWSER_UNSAFE_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

// ─── Shared bits ────────────────────────────────────────────────────────────--

/** Provenance chip: did this value come from an operator override or the env seed? */
export function SourceBadge({ source }: { source: NetSource }) {
  if (source === 'store') {
    return <Badge variant="secondary" className="text-[10px]">Override</Badge>;
  }
  if (source === 'env') {
    return <Badge variant="outline" className="text-[10px]">From env</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Auto</Badge>;
}

/** Shared fallback while NetworkConfig is loading or failed to load. `onRetry`,
 *  when given, renders a Retry button (the containing tab has no other refresh). */
function NetFallback({ loading, onRetry }: { loading: boolean; onRetry?: () => void }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
      <p className="text-xs text-muted-foreground">Couldn’t load networking settings.</p>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

// ─── Public address (merged readout + editable override) ─────────────────────--

/** How the detected address was found, in plain language (drives the readout). */
const ADDRESS_SOURCE_LABEL: Record<string, string> = {
  'host-env': 'from your override / env',
  'ip-env': 'from your override / env',
  interface: 'auto-detected on this server',
  detected: 'your connection’s address (behind a router)',
  none: 'not detected',
};

export function PublicAddressCard({
  instance,
  publicAddress,
  netLoading,
  onRecheck,
  rechecking,
  onSaved,
}: {
  /** The canonical advertised-address readout (always present from listDomains). */
  instance: DomainsInstance | null;
  /** The editable override values + provenance (from getNetworkConfig), null while loading/failed. */
  publicAddress: NetworkConfig['publicAddress'] | null;
  netLoading: boolean;
  onRecheck: () => void;
  rechecking: boolean;
  onSaved: () => void;
}) {
  const [host, setHost] = useState('');
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const behindNat = instance?.dnsTargetSource === 'detected';
  const noAddress = Boolean(instance) && !instance!.dnsTarget; // air-gapped / full-NAT
  const hasOverride =
    publicAddress?.host.source === 'store' || publicAddress?.ip.source === 'store';

  // Re-seed inputs whenever fresh config arrives (mount, save/reload, re-check).
  // Skipped while a save is in flight so keystrokes typed during the follow-up
  // refetch aren't reverted to the just-saved server value.
  useEffect(() => {
    if (publicAddress && !busy) {
      setHost(publicAddress.host.value);
      setIp(publicAddress.ip.value);
    }
  }, [busy, publicAddress?.host.value, publicAddress?.ip.value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open the manual editor when detection is wrong or unavailable (behind NAT,
  // nothing detected) or an override is already set — otherwise keep it collapsed so
  // a correctly-detected box stays clean.
  useEffect(() => {
    if (behindNat || noAddress || hasOverride) setManualOpen(true);
  }, [behindNat, noAddress, hasOverride]);

  const dirty =
    Boolean(publicAddress) &&
    (host.trim() !== publicAddress!.host.value || ip.trim() !== publicAddress!.ip.value);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await putNetworkConfig({ publicHost: host.trim(), publicIp: ip.trim() });
      setMsg({ ok: r.ok, text: r.ok ? 'Saved — applies immediately.' : r.error || 'Save failed.' });
      // Keep inputs locked until the follow-up refetch lands, so the re-seed effect
      // reconciles against the saved value rather than clobbering in-flight edits.
      if (r.ok) await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Globe className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-medium">Public address</h3>
            <p className="text-xs text-muted-foreground">The address this instance advertises for DNS.</p>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Advertised</p>
            <button
              type="button"
              onClick={onRecheck}
              disabled={rechecking}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
              title="Re-detect this server’s public address"
            >
              <RefreshCw className={cn('size-3', rechecking && 'animate-spin')} />
              Re-check
            </button>
          </div>
          {instance?.dnsTarget ? (
            <>
              <p className="font-mono text-xs text-foreground">
                {instance.dnsTargetType} → {instance.dnsTarget}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {ADDRESS_SOURCE_LABEL[instance.dnsTargetSource] ?? instance.dnsTargetSource}
                {!instance.publiclyRoutable && ' — looks private/NAT'}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">none detected</p>
          )}
        </div>
      </div>

      {behindNat && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          Detection found your <span className="font-medium">connection’s</span> address, not this
          machine’s — the box is behind a router. If you forward ports or use dynamic DNS, set the
          real reachable address below so custom-domain records and certificates point at the right
          place.
        </p>
      )}

      {noAddress && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          Couldn’t reach this server’s public IP from its network interfaces or the internet — it
          looks air-gapped or fully behind NAT. Hit <span className="font-medium">Re-check</span> once
          it has outbound access, point your domain at the server’s public IP manually, or set the
          address below.
        </p>
      )}

      {/* Editable override — collapsed by default on a correctly-detected box. */}
      <div className="mt-3">
        <button
          type="button"
          aria-expanded={manualOpen}
          onClick={() => setManualOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="size-3.5" />
          Detection wrong? Set the address manually
          <span aria-hidden="true" className={cn('transition-transform', manualOpen && 'rotate-90')}>›</span>
        </button>

        {manualOpen && (
          <div className="mt-3 space-y-3">
            {!publicAddress ? (
              <NetFallback loading={netLoading} onRetry={onRecheck} />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="flex items-center gap-2 text-xs font-medium">
                      Public hostname <SourceBadge source={publicAddress.host.source} />
                    </span>
                    <Input
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="e.g. box.dyndns.example"
                      spellCheck={false}
                      autoCapitalize="off"
                      disabled={busy}
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      A CNAME target (overrides <span className="font-mono">EXEPAD_PUBLIC_HOST</span>).
                    </span>
                  </label>
                  <label className="space-y-1">
                    <span className="flex items-center gap-2 text-xs font-medium">
                      Public IPv4 <SourceBadge source={publicAddress.ip.source} />
                    </span>
                    <Input
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      placeholder="e.g. 203.0.113.10"
                      spellCheck={false}
                      autoCapitalize="off"
                      disabled={busy}
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      An A-record target (overrides <span className="font-mono">EXEPAD_PUBLIC_IP</span>).
                    </span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" size="sm" onClick={save} disabled={busy || !dirty}>
                    {busy ? 'Saving…' : 'Save address'}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    Clear a field to fall back to auto-detection.
                  </span>
                  {msg && (
                    <span className={cn('text-xs', msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                      {msg.text}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Studio + apps front ports (editable listen ports) ───────────────────────--

/**
 * The editable socket knob(s): the studio's FRONT-facing port. In the MANAGED
 * container (our in-image Caddy under host networking) the front splits into TWO
 * ports — the APPS port every published app subdomain serves on (default 443 → clean
 * per-app URLs) and the STUDIO port the admin studio serves on, which may differ.
 * Elsewhere (runtime in-process TLS, or an EXTERNAL TLS proxy) it's a single front
 * port. All bind at startup, so a saved change applies on the NEXT restart, not live —
 * each editor shows the port running now vs. the configured one and flags a pending
 * restart. Behind an external proxy the proxy owns the port, so the field is read-only.
 */
export function ServerSection({
  server,
  netLoading,
  onSaved,
  onRetry,
}: {
  server: NetworkConfig['server'] | null;
  netLoading: boolean;
  onSaved: () => void | Promise<void>;
  onRetry?: () => void;
}) {
  if (!server) return <NetFallback loading={netLoading} onRetry={onRetry} />;
  // Managed container → two independent front ports; otherwise a single front port.
  return server.managedTls ? (
    <TwoPortEditor server={server} onSaved={onSaved} />
  ) : (
    <SingleFrontEditor server={server} onSaved={onSaved} />
  );
}

/** The port the operator is actually viewing the studio on, read from the browser so
 *  it matches the real URL (443 shows as 443, not the internal HTTP hop). */
function readViewingOrigin(fallbackPort: number): { origin: string | null; port: string } {
  const loc = typeof window !== 'undefined' ? window.location : null;
  return {
    origin: loc?.origin ?? null,
    port: loc ? loc.port || (loc.protocol === 'https:' ? '443' : '80') : String(fallbackPort),
  };
}

interface PortValidation { ok: boolean; unsafe: boolean; inRange: boolean }

/** Validate a port string the same way the worker does (range + browser-blocked). */
function validatePort(raw: string): PortValidation {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  const inRange = trimmed === '' || (Number.isInteger(n) && n >= 1 && n <= 65535);
  // A browser-blocked port (e.g. 6000 = X11) binds fine but the studio would be
  // unreachable there — reject it up front instead of leading into ERR_UNSAFE_PORT.
  const unsafe = inRange && trimmed !== '' && BROWSER_UNSAFE_PORTS.has(n);
  return { ok: inRange && !unsafe, unsafe, inRange };
}

/** One labelled port input with a live example URL + inline validation errors. The
 *  optional `note` is a quiet, user-facing status ("default", "same as apps") — not
 *  the store/env provenance, which is internal plumbing the operator shouldn't see. */
function PortField({
  label,
  note,
  hint,
  value,
  onChange,
  placeholder,
  disabled,
  validation,
  scheme,
  exampleHost,
}: {
  label: string;
  note?: string;
  hint: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled: boolean;
  validation: PortValidation;
  scheme: string;
  exampleHost: string;
}) {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  const defaultPort = scheme === 'https' ? 443 : 80;
  const shownPort = trimmed && parsed !== defaultPort ? `:${trimmed}` : '';
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline gap-2 text-xs font-medium">
        {label}
        {note && <span className="text-[10px] font-normal text-muted-foreground">· {note}</span>}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
          className="h-8 max-w-[8rem] font-mono"
        />
        <span className="font-mono text-[11px] text-muted-foreground">
          {scheme}://{exampleHost}{shownPort}
        </span>
      </div>
      <span className="block text-[11px] text-muted-foreground">{hint}</span>
      {!validation.inRange && (
        <span className="block text-[11px] text-destructive">Enter a port between 1 and 65535.</span>
      )}
      {validation.unsafe && (
        <span className="block text-[11px] text-destructive">
          Port {parsed} is blocked by web browsers — try 9000, 8443, or 3000.
        </span>
      )}
    </label>
  );
}

/** A compact on/off switch (mirrors the one in CustomDomainsSettings). */
function Toggle({
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

/**
 * Amber pending-restart banner with the self-restart button + progress bar, shared by
 * both editors. Managed container only: the server acks then exits; Docker fully
 * restarts it (Caddy + runtime + agent, ~30s) on the new port(s). Our tab is on the OLD
 * port, so POLL `newOrigin` until it accepts connections and only THEN navigate — never
 * redirect on a fixed timer (that raced the restart and gave ERR_CONNECTION_REFUSED). A
 * cross-origin no-cors probe resolves once the server responds and rejects while refused.
 */
function RestartBanner({
  canSelfRestart,
  newOrigin,
  children,
}: {
  canSelfRestart: boolean;
  newOrigin: string;
  children: ReactNode;
}) {
  const [restarting, setRestarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  async function restartToApply() {
    setRestarting(true);
    setElapsed(0);
    setErr(null);
    const r = await restartInstance();
    if (!r.ok) {
      setRestarting(false);
      setErr(r.error || 'Could not restart automatically.');
      return;
    }
    const target = `${newOrigin}/`;
    const start = Date.now();
    const DEADLINE_MS = 120_000;
    const poll = async () => {
      setElapsed(Math.round((Date.now() - start) / 1000));
      try {
        await fetch(target, { mode: 'no-cors', cache: 'no-store' });
        window.location.assign(target); // it's back up — go
      } catch {
        if (Date.now() - start < DEADLINE_MS) {
          setTimeout(poll, 1500);
        } else {
          setRestarting(false);
          setErr(`Still waiting for the studio. Open ${newOrigin} once it’s back.`);
        }
      }
    };
    // Wait a beat before the first probe — the old listener is still closing.
    setTimeout(poll, 2000);
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
      <p>{children}</p>
      {canSelfRestart &&
        (restarting ? (
          <div className="space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-500/20">
              {/* Fills over the ~30s a restart takes, capped at 95% until the new
                  port actually answers — then we navigate. */}
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-700 ease-out"
                style={{ width: `${Math.min(95, Math.round((elapsed / 30) * 100))}%` }}
              />
            </div>
            <p>
              Restarting the studio — reopening at{' '}
              <span className="font-mono">{newOrigin}</span> once it’s back ({elapsed}s, usually ~30s)…
            </p>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={restartToApply}>
            Restart to apply
          </Button>
        ))}
      {err && <p className="text-destructive">{err}</p>}
    </div>
  );
}

/**
 * Screen-level restart-to-apply banner. Boot settings (the front ports, direct-IP
 * access) only take effect on restart; rather than a banner per control, the Access
 * screen shows this ONE banner whenever any of them is pending. The managed container
 * self-restarts and reopens automatically; otherwise it asks the operator to restart.
 */
export function PendingRestartBanner({ server }: { server: NetworkConfig['server'] | null }) {
  if (!server) return null;
  const pending = server.managedTls
    ? server.studio.pendingRestart || server.apps.pendingRestart || server.ipAccess.pendingRestart
    : server.pendingRestart;
  if (!pending) return null;
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const cp = server.managedTls ? server.studio.configuredPort : server.configuredPort;
  const isHttps = server.managedTls || server.portKind === 'https';
  const scheme = isHttps ? 'https' : 'http';
  const defaultPort = isHttps ? 443 : 80;
  const newOrigin = `${scheme}://${host}${cp === defaultPort ? '' : `:${cp}`}`;
  return (
    <RestartBanner canSelfRestart={server.canSelfRestart} newOrigin={newOrigin}>
      You have changes that take effect after a restart
      {server.managedTls && server.ipAccess.pendingRestart
        ? ` — direct IP access will be ${server.ipAccess.allowed ? 'enabled' : 'disabled'}`
        : ''}
      .{' '}
      {server.canSelfRestart
        ? 'Restart now to apply them — the studio reopens automatically.'
        : 'Restart the server to apply them.'}
    </RestartBanner>
  );
}

/**
 * "This server's IP" — the box's own IP address as a way in, alongside any domain (they
 * coexist). The <dashed-ip>.sslip.io host is always browser-trusted; a toggle ALSO serves
 * the raw IP directly (a one-time cert warning) for a LAN / offline box where sslip can't
 * resolve. Managed container + a known public IP only; the toggle applies on restart (the
 * screen-level PendingRestartBanner surfaces it).
 */
export function IpAccessSection({
  instance,
  server,
  onSaved,
}: {
  instance: DomainsInstance | null;
  server: NetworkConfig['server'] | null;
  onSaved: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!server?.managedTls) return null;
  const trustedUrl = instance?.tls.trustedUrl ?? null;
  const rawIp = instance?.dnsTargetType === 'A' ? instance.dnsTarget : null;
  if (!trustedUrl && !rawIp) return null; // no public IP → nothing to serve on

  const port = server.studio.configuredPort;
  const rawUrl = rawIp ? `https://${rawIp}${port === 443 ? '' : `:${port}`}` : null;
  const allowed = server.ipAccess.allowed;
  const trusted = server.ipAccess.trustedCert;

  async function toggle(next: boolean) {
    setBusy(true);
    setErr(null);
    const r = await putNetworkConfig({ allowIpAccess: next });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error || 'Could not update IP access.');
      return;
    }
    await onSaved();
  }

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">This server’s IP</h3>
        <p className="text-xs text-muted-foreground">
          Reach the studio by the machine’s address — works alongside your domain, no DNS needed.
        </p>
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {trustedUrl && (
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Lock className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <a
                href={trustedUrl}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-mono text-[13px] font-medium text-foreground hover:underline"
              >
                {trustedUrl.replace(/^https?:\/\//, '')}
              </a>
              <p className="text-[11px] text-muted-foreground">
                Secure link · <span className="text-emerald-600 dark:text-emerald-400">browser-trusted</span> · always on
              </p>
            </div>
          </div>
        )}
        {rawUrl && (
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-lg',
                allowed && trusted
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {allowed && trusted ? <Lock className="size-3.5" /> : <Server className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate font-mono text-[13px] font-medium',
                  allowed ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {rawUrl.replace(/^https?:\/\//, '')}
              </span>
              <p className="text-[11px] text-muted-foreground">
                Raw IP ·{' '}
                {!allowed ? (
                  'off — IP visitors go to the secure link'
                ) : trusted ? (
                  <span className="text-emerald-600 dark:text-emerald-400">browser-trusted (Let’s Encrypt)</span>
                ) : (
                  'served directly — getting a trusted certificate… (one-time warning until it arrives)'
                )}
              </p>
            </div>
            <Toggle checked={allowed} disabled={busy} onChange={toggle} label="Serve the raw IP directly" />
          </div>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        When on, the box automatically obtains a short-lived Let’s Encrypt certificate for the IP
        (renewed for you), so a public server shows no warning. On a LAN or offline box that can’t
        reach Let’s Encrypt, it falls back to a one-time warning — the trusted secure link above
        still works either way. Applies on restart.
      </p>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </section>
  );
}

/** Managed container: the two independent front ports (studio + apps). The IP toggle and
 *  the restart-to-apply banner live at the Access-screen level (they span sections), so
 *  this just edits + saves the ports. */
function TwoPortEditor({
  server,
  onSaved,
}: {
  server: NetworkConfig['server'];
  onSaved: () => void | Promise<void>;
}) {
  const [studioPort, setStudioPort] = useState('');
  const [appsPort, setAppsPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Re-seed from the configured ports on fresh config, except while a save is in flight.
  useEffect(() => {
    if (!busy) {
      setStudioPort(String(server.studio.configuredPort));
      setAppsPort(String(server.apps.configuredPort));
    }
  }, [busy, server.studio.configuredPort, server.apps.configuredPort]); // eslint-disable-line react-hooks/exhaustive-deps

  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const studioV = validatePort(studioPort);
  const appsV = validatePort(appsPort);
  const dirty =
    studioPort.trim() !== String(server.studio.configuredPort) ||
    appsPort.trim() !== String(server.apps.configuredPort);
  const allValid = studioV.ok && appsV.ok;

  async function save() {
    // Send ONLY the field(s) the operator actually changed. Sending both would persist
    // the untouched port as an explicit override — pinning a studio that was tracking the
    // apps port (its default), or a still-env-seeded apps port, against future changes.
    const payload: NetworkUpdate = {};
    if (studioPort.trim() !== String(server.studio.configuredPort)) payload.studioPort = studioPort.trim();
    if (appsPort.trim() !== String(server.apps.configuredPort)) payload.appsPort = appsPort.trim();
    if (Object.keys(payload).length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await putNetworkConfig(payload);
      setMsg({ ok: r.ok, text: r.ok ? 'Saved — restart to apply.' : r.error || 'Save failed.' });
      if (r.ok) await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <PortField
        label="Studio port"
        note={studioPort.trim() === appsPort.trim() ? 'same as apps' : undefined}
        hint="The admin studio — this control panel."
        value={studioPort}
        onChange={setStudioPort}
        placeholder="443"
        disabled={busy}
        validation={studioV}
        scheme="https"
        exampleHost={host}
      />
      <PortField
        label="Apps port"
        note={appsPort.trim() === '443' ? 'default' : undefined}
        hint="Every published app’s address. All apps share this one port."
        value={appsPort}
        onChange={setAppsPort}
        placeholder="443"
        disabled={busy}
        validation={appsV}
        scheme="https"
        exampleHost={`app.${host}`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={busy || !dirty || !allValid}>
          {busy ? 'Saving…' : 'Save ports'}
        </Button>
        {msg && (
          <span className={cn('text-xs', msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
            {msg.text}
          </span>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Give the studio its own port to keep the admin panel off your public app port; set both the
        same for a single unified address. Ports bind at startup, so a change applies on restart.
      </p>
    </div>
  );
}

/** Local in-process TLS or an external TLS proxy: a single editable front port. */
function SingleFrontEditor({
  server,
  onSaved,
}: {
  server: NetworkConfig['server'];
  onSaved: () => void | Promise<void>;
}) {
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!busy) setPort(String(server.configuredPort));
  }, [busy, server.configuredPort]); // eslint-disable-line react-hooks/exhaustive-deps

  const isHttps = server.portKind === 'https';
  const scheme = isHttps ? 'https' : 'http';
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const { origin: viewingOrigin, port: viewingPort } = readViewingOrigin(server.frontPort);

  const v = validatePort(port);
  const dirty = port.trim() !== String(server.configuredPort);
  const defaultPort = isHttps ? 443 : 80;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await putNetworkConfig(isHttps ? { httpsPort: port.trim() } : { httpPort: port.trim() });
      setMsg({
        ok: r.ok,
        text: r.ok
          ? server.canSelfRestart
            ? 'Saved — click “Restart to apply” to serve on the new port.'
            : 'Saved — restart the server to serve on the new port.'
          : r.error || 'Save failed.',
      });
      if (r.ok) await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Server className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Studio port</h3>
      </div>

      {viewingOrigin && (
        <p className="text-xs text-muted-foreground">
          You’re viewing the studio at{' '}
          <span className="font-mono text-foreground">{viewingOrigin}</span> — served on port{' '}
          <span className="font-mono text-foreground">{viewingPort}</span>.
        </p>
      )}

      {/* Only an EXTERNAL reverse proxy makes the port un-ownable from here. */}
      {!server.editable ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          A reverse proxy of your own terminates TLS in front of this instance and owns the public
          address and port. Set the port where that proxy listens — this instance can’t change it from
          here.
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <PortField
            label={isHttps ? 'HTTPS port' : 'HTTP port'}
            note={port.trim() === String(defaultPort) ? 'default' : undefined}
            hint="The port you reach the studio on."
            value={port}
            onChange={setPort}
            placeholder={isHttps ? '443' : '8080'}
            disabled={busy}
            validation={v}
            scheme={scheme}
            exampleHost={host}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={save} disabled={busy || !dirty || !v.ok}>
              {busy ? 'Saving…' : 'Save port'}
            </Button>
            {msg && (
              <span className={cn('text-xs', msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                {msg.text}
              </span>
            )}
          </div>
        </div>
      )}

      {server.editable && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The port binds at startup, so a change takes effect after the server restarts.
        </p>
      )}
    </div>
  );
}

