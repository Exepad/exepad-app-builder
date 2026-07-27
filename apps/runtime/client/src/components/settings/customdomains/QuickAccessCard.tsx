/**
 * Quick Access — one-click public link to the WHOLE studio via a Cloudflare quick
 * tunnel (`*.trycloudflare.com`), for a rig BEHIND A ROUTER where a custom domain /
 * port-forwarding isn't possible. The purpose is to reach your OWN rig easily from
 * anywhere; it is NOT app publishing (that's per-app "Share live URL").
 *
 * Safe because the studio is login-gated end-to-end — an unauthenticated visitor to
 * the random URL only ever sees /login — and the URL is unguessable + ephemeral (it
 * dies when the tunnel stops or the server restarts). Backend: /api/quick-access/*.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, ShieldAlert, Square, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  startQuickAccess,
  stopQuickAccess,
  streamQuickAccessStatus,
  type TunnelStatus,
} from '@/services/StudioStream';

export default function QuickAccessCard() {
  const [status, setStatus] = useState<TunnelStatus>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Re-attach to an already-live tunnel (e.g. after a settings-page remount) and
  // follow live transitions. The SSE stream emits the current snapshot immediately.
  useEffect(() => {
    const ctrl = new AbortController();
    streamQuickAccessStatus((ev) => {
      if (ev.status) setStatus(ev.status);
      if ('url' in ev) setUrl(ev.url ?? null);
      if ('error' in ev) setError(ev.error ?? null);
    }, ctrl.signal);
    return () => ctrl.abort();
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus('starting');
    try {
      const r = await startQuickAccess();
      if (r.ok) {
        setStatus(r.status ?? 'live');
        if (r.url) setUrl(r.url);
      } else {
        setStatus('error');
        setError(r.error ?? 'Could not start Quick Access.');
      }
    } catch {
      // A network-layer failure (server restarting mid-request) throws through the
      // fetch — surface it rather than stranding the button on "Creating link…".
      setStatus('error');
      setError('Could not reach the server — try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await stopQuickAccess();
    } catch {
      /* best-effort — reset locally regardless */
    } finally {
      setBusy(false);
      setStatus('idle');
      setUrl(null);
      setError(null);
    }
  }, []);

  const copy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the input is selectable as a fallback */
    }
  }, [url]);

  const live = status === 'live' && Boolean(url);
  const working = busy || status === 'starting' || status === 'stopping';

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Zap className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Quick Access link</p>
          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
            Get a temporary <span className="font-medium text-foreground">https://</span> link to this
            studio that works from anywhere — no domain, no port forwarding, no account. It dials out
            through a Cloudflare tunnel, so it’s the fastest way to reach a rig behind a router.
          </p>
        </div>
      </div>

      {live ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Live
            </span>
            <span className="text-[11px] text-muted-foreground">Anyone with this link reaches the login page.</span>
          </div>
          <div className="flex gap-2">
            <Input readOnly value={url!} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </Button>
            <Button type="button" size="sm" variant="outline" asChild>
              <a href={url!} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" /> <span className="hidden sm:inline">Open</span>
              </a>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={stop} disabled={busy}>
              <Square className="size-3.5" /> Stop
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Temporary — the link changes each time and dies when you stop it or the server restarts.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={start} disabled={working}>
            {working ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> {status === 'stopping' ? 'Stopping…' : 'Creating link…'}
              </>
            ) : (
              <>
                <Zap className="size-3.5" /> Start Quick Access
              </>
            )}
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>
          This exposes your studio’s login page at a public URL. It stays protected by your operator
          login — but stop the link when you’re done, and use a strong password.
        </span>
      </p>
    </div>
  );
}
