import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Clock,
  ExternalLink,
  Layers3,
  Loader2,
  PlusCircle,
  Settings as SettingsIcon,
  Trash2,
} from 'lucide-react';
import { deleteApp, listAppsPage, type StudioApp } from '../services/StudioStream';
import type { StudioOutletContext } from '@/components/studio/StudioShell';
import { resolvePublishedAppUrl } from '@/lib/published-url';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

function statusVariant(status: string): BadgeVariant {
  if (status === 'published') return 'default';
  if (status === 'error') return 'destructive';
  return 'secondary';
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

function AppCard({ app, onDeleted }: { app: StudioApp; onDeleted: (id: string) => void }) {
  // The maintenance cron captures a thumbnail to thumbnailUrl; fall back to the
  // placeholder before one exists or if the image fails to load (e.g. revoked).
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = Boolean(app.thumbnailUrl) && !thumbFailed;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteApp(app.id);
    setDeleting(false);
    if (result.ok) {
      setConfirmOpen(false);
      toast.success(
        result.partial
          ? 'App removed (some storage cleanup was incomplete).'
          : 'App deleted.',
      );
      onDeleted(app.id);
    } else {
      toast.error(result.error || 'Failed to delete app.');
    }
  }
  return (
    <Card className="hover-lift overflow-hidden p-0">
      <Link to={`/studio/${app.id}`} className="block">
        <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-muted to-muted/40">
          {showThumb ? (
            <img
              src={app.thumbnailUrl ?? undefined}
              alt={`${app.name} preview`}
              loading="lazy"
              className="h-full w-full object-cover object-top"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Layers3 className="h-10 w-10 text-muted-foreground/50" />
            </div>
          )}
          <Badge
            variant={statusVariant(app.status)}
            className="absolute right-3 top-3 capitalize"
          >
            {app.status}
          </Badge>
        </div>
      </Link>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              to={`/studio/${app.id}`}
              className="block truncate font-medium hover:underline"
            >
              {app.name}
            </Link>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>Updated {relativeTime(app.updatedAt)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <Link to={`/studio/${app.id}`} aria-label="Open in studio">
                    <SettingsIcon className="h-4 w-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in studio</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a
                    href={resolvePublishedAppUrl(app.publishedUrl || app.previewUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={app.publishedUrl ? 'Open live app' : 'Open preview'}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {app.publishedUrl ? 'Open live app' : 'Open preview'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label="Delete app"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete app</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this app?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{app.name}</span> and all of its
              data (preview + published databases, files, and build history) will be permanently
              removed. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Delete app
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const PAGE_SIZE = 12;

export default function AppsPage() {
  useOutletContext<StudioOutletContext>(); // ensures shell context is available
  const [apps, setApps] = useState<StudioApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await listAppsPage({ limit: PAGE_SIZE });
      if (!cancelled) {
        setApps(page.apps);
        setNextCursor(page.nextCursor);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const page = await listAppsPage({ limit: PAGE_SIZE, cursor: nextCursor });
    setApps((prev) => [...prev, ...page.apps]);
    setNextCursor(page.nextCursor);
    setLoadingMore(false);
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
          <p className="text-sm text-muted-foreground">
            Build, preview and publish your apps.
          </p>
        </div>
        <Button asChild>
          <Link to="/studio">
            <PlusCircle className="h-4 w-4" />
            New app
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden p-0">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </Card>
          ))}
        </div>
      ) : apps.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 border-dashed p-12 text-center">
          <Layers3 className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium">No apps yet</p>
            <p className="text-sm text-muted-foreground">
              Start by describing one in the studio.
            </p>
          </div>
          <Button asChild>
            <Link to="/studio">
              <PlusCircle className="h-4 w-4" />
              Build your first app
            </Link>
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {apps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onDeleted={(id) => setApps((prev) => prev.filter((a) => a.id !== id))}
              />
            ))}
          </div>

          {nextCursor && (
            <div className="mt-8 flex items-center justify-center">
              <Button variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
