/**
 * The DNS records an operator must create, each with a LIVE status pill that
 * tells them — without leaving the page — whether what they typed at their
 * registrar is actually visible to us yet. Polls GET /api/domains/:d/check on a
 * gentle interval while the wizard is open; never mutates state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  Check,
  CircleAlert,
  Copy,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  checkDomainDns,
  type DnsCheckState,
  type DnsRecordCheck,
  type DomainDnsRecord,
} from '@/services/StudioStream';

const POLL_MS = 8000;

export function CopyButton({
  text,
  label = 'Copy',
  srLabel,
}: {
  text: string;
  label?: string;
  /** Accessible name when the visible label is empty (icon-only buttons). */
  srLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const accessibleName = srLabel || label || 'Copy';
  return (
    <button
      type="button"
      aria-label={accessibleName}
      title={accessibleName}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      <Copy className="size-3" />
      {copied ? 'Copied' : label}
    </button>
  );
}

// `spin` states render Loader2 in StatePill so the animation can honor
// prefers-reduced-motion (the icon can't carry a conditional class from a const).
const PILL: Record<DnsCheckState | 'checking', { cls: string; label: string; icon?: React.ReactNode; spin?: boolean }> = {
  ok: {
    cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    label: 'Detected',
    icon: <Check className="size-3" />,
  },
  mismatch: {
    cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    label: 'Different value',
    icon: <TriangleAlert className="size-3" />,
  },
  missing: {
    cls: 'border-border bg-muted text-muted-foreground',
    label: 'Waiting…',
    spin: true,
  },
  error: {
    cls: 'border-destructive/40 bg-destructive/10 text-destructive',
    label: 'Lookup failed',
    icon: <CircleAlert className="size-3" />,
  },
  skipped: {
    cls: 'border-border bg-muted text-muted-foreground',
    label: 'N/A',
    icon: <span className="text-[10px]">—</span>,
  },
  checking: {
    cls: 'border-border bg-muted text-muted-foreground',
    label: 'Checking…',
    spin: true,
  },
};

function StatePill({ state }: { state: DnsCheckState | 'checking' }) {
  const reduced = useReducedMotion();
  const p = PILL[state];
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', p.cls)}
    >
      {p.spin ? <Loader2 className={cn('size-3', !reduced && 'animate-spin')} /> : p.icon}
      {p.label}
    </span>
  );
}

export default function DnsRecordSignals({
  domain,
  records,
  enabled = true,
  intro,
  onStableAllGreen,
}: {
  domain: string;
  records: DomainDnsRecord[];
  /** Poll live status while true (e.g. the wizard step is visible & not active). */
  enabled?: boolean;
  /** Overrides the default "create these records" intro line. */
  intro?: React.ReactNode;
  /**
   * Fires ONCE after two consecutive polls in which every record (excluding
   * 'skipped') is Detected — a propagation-race debounce so the wizard can
   * auto-activate without burning its one shot on a resolver flap.
   */
  onStableAllGreen?: () => void;
}) {
  const reduced = useReducedMotion();
  const [checks, setChecks] = useState<DnsRecordCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards: don't setState after unmount, and don't let a slow check clobber a
  // newer one (the interval tick + a manual Re-check can overlap on a slow network).
  const mountedRef = useRef(true);
  const genRef = useRef(0);
  // Abort the in-flight /check on unmount / supersede so a poll that raced a
  // domain deletion (Start over) never lands as a console 404 after the row is gone.
  const abortRef = useRef<AbortController | null>(null);
  // Stable-green debounce: count consecutive all-green polls, fire the callback once.
  const greenStreakRef = useRef(0);
  const stableFiredRef = useRef(false);
  const onStableRef = useRef(onStableAllGreen);
  onStableRef.current = onStableAllGreen;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const runCheck = useCallback(async () => {
    const gen = ++genRef.current;
    abortRef.current?.abort(); // supersede any older in-flight check
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setChecking(true);
    let res: Awaited<ReturnType<typeof checkDomainDns>>;
    try {
      res = await checkDomainDns(domain, ctrl.signal);
    } catch {
      // Aborted (unmount / supersede) or network drop — the guard below no-ops.
      res = { ok: false, records: [] };
    }
    // Ignore if we unmounted, or a newer check superseded this one.
    if (!mountedRef.current || gen !== genRef.current) return;
    if (res.ok) {
      setChecks(res.records);
      setCheckedAt(res.checkedAt ?? new Date().toISOString());
      const relevant = res.records.filter((r) => r.state !== 'skipped');
      const allGreen = relevant.length > 0 && relevant.every((r) => r.state === 'ok');
      greenStreakRef.current = allGreen ? greenStreakRef.current + 1 : 0;
      if (allGreen && greenStreakRef.current >= 2 && !stableFiredRef.current) {
        stableFiredRef.current = true;
        onStableRef.current?.();
      }
    }
    setChecking(false);
  }, [domain]);

  useEffect(() => {
    if (!enabled || records.length === 0) return;
    void runCheck();
    timer.current = setInterval(() => void runCheck(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [enabled, records.length, runCheck]);

  const stateFor = (r: DomainDnsRecord): DnsCheckState | 'checking' => {
    const hit = checks.find((c) => c.type === r.type && c.name === r.name);
    if (!hit) return checking ? 'checking' : 'missing';
    return hit.state;
  };
  const detailFor = (r: DomainDnsRecord): string | undefined =>
    checks.find((c) => c.type === r.type && c.name === r.name)?.detail;

  if (records.length === 0) {
    return <p className="text-xs text-muted-foreground">No DNS records to create for this option.</p>;
  }

  const okCount = records.filter((r) => stateFor(r) === 'ok').length;

  return (
    <div className="space-y-2">
      {/* Announce progress to assistive tech as records flip to Detected. */}
      <p className="sr-only" role="status" aria-live="polite">
        {okCount} of {records.length} DNS records detected.
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {intro ?? 'Add these at the website where you manage your domain — we check automatically every few seconds:'}
        </p>
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={checking}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3', checking && !reduced && 'animate-spin')} />
          Re-check
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Type</th>
              <th className="px-2 py-1.5 font-medium">Name</th>
              <th className="px-2 py-1.5 font-medium">Value</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => {
              const state = stateFor(r);
              const detail = detailFor(r);
              return (
                <tr key={i} className="border-t align-top">
                  <td className="px-2 py-1.5 font-mono">{r.type}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="break-all font-mono">{r.name}</span>
                      <CopyButton text={r.name} label="" srLabel={`Copy ${r.type} record name`} />
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="break-all font-mono">{r.value}</span>
                      <CopyButton text={r.value} label="" srLabel={`Copy ${r.type} record value`} />
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col gap-1">
                      <StatePill state={state} />
                      {detail && state !== 'ok' && (
                        <span className="text-[10px] leading-tight text-muted-foreground">{detail}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {records.some((r) => r.note) && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {records.filter((r) => r.note).map((r, i) => (
            <li key={i}>{r.note}</li>
          ))}
        </ul>
      )}
      {checkedAt && (
        <p className="text-[10px] text-muted-foreground">
          Last checked {new Date(checkedAt).toLocaleTimeString()}. Re-checks every {POLL_MS / 1000}s.
        </p>
      )}
    </div>
  );
}
