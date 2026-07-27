/**
 * "Update available" banner for the Settings page.
 *
 * Purely informational: the container cannot update itself (the process that
 * pulls + recreates it would die mid-update), so this surfaces the newer
 * version and the operator command that applies it safely (`exepad update`
 * snapshots /data first). Renders nothing while loading, when up to date,
 * when the check is disabled (air-gapped), or on a dev build — the banner
 * must never nag or block.
 */
import { useEffect, useState } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import { getUpdateCheck, type UpdateCheck } from '../../services/StudioStream';

const DISMISS_KEY = 'exepad.update-banner.dismissed';

export default function UpdateBanner() {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUpdateCheck()
      .then((c) => {
        if (cancelled || !c) return;
        // Session-scoped dismissal, keyed by version so a NEWER release
        // re-surfaces the banner even if an older one was dismissed.
        if (sessionStorage.getItem(DISMISS_KEY) === c.latest) setDismissed(true);
        setCheck(c);
      })
      .catch(() => {
        /* never surface a failed check */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!check || !check.enabled || check.updateAvailable !== true || dismissed) return null;

  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
    >
      <ArrowUpCircle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Exepad {check.latest} is available (you are on {check.current}).
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Update from the machine that runs this instance — it backs up your data first:
        </p>
        {/* applyWith is guaranteed non-null whenever updateAvailable is true —
            the server builds both in the same branch. Single source of truth. */}
        <code className="mt-2 block w-fit max-w-full overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
          {check.applyWith}
        </code>
      </div>
      <button
        type="button"
        aria-label="Dismiss update notice"
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => {
          if (check.latest) sessionStorage.setItem(DISMISS_KEY, check.latest);
          setDismissed(true);
        }}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
