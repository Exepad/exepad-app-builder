import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  ArrowUp,
  Blocks,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Cloud,
  Code2,
  Copy,
  Database,
  ExternalLink,
  Globe,
  History,
  Image as ImageIcon,
  Loader2,
  Monitor,
  Package,
  Palette,
  PowerOff,
  RefreshCw,
  Rocket,
  Save,
  Server,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Tablet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  authMe,
  cancelRun,
  getApp,
  listVersions,
  publishApp,
  unpublishApp,
  restoreVersion,
  runBuild,
  startTunnel,
  stopTunnel,
  streamChat,
  streamTunnelStatus,
  type AppVersion,
  type StudioEvent,
  type TunnelStatus,
} from '../services/StudioStream';
import AdminPanel from '../components/admin/AdminPanel';
import SourcePanel from '../components/admin/SourcePanel';
import { Logo } from '@/components/studio/Logo';
import AppDomainSection from '@/components/settings/customdomains/AppDomainSection';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { resolvePublishedAppUrl } from '@/lib/published-url';
import { useIsMobile } from '@/hooks';

type Device = 'desktop' | 'tablet' | 'mobile';

// `dims` are the device's CSS-pixel viewport. The tablet/mobile preview renders
// the iframe AT these true dimensions and scales it down to fit the preview pane
// (devtools-style) — so "Tablet"/"Mobile" show the real device layout instead of
// just squishing the app to the pane width. `null` = desktop (fills the pane).
const DEVICES: Record<Device, { label: string; icon: typeof Monitor; dims: { w: number; h: number } | null }> = {
  desktop: { label: 'Desktop', icon: Monitor, dims: null },
  tablet: { label: 'Tablet', icon: Tablet, dims: { w: 768, h: 1024 } },
  mobile: { label: 'Mobile', icon: Smartphone, dims: { w: 390, h: 844 } },
};

function relTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

// ─── Agent activity timeline (Claude-Code-style step grouping) ─────────────────
//
// The agent streams flat `progress` events carrying an `action` code and a human
// `internal_message` (there is no Django normalizer in self-host). We bucket each
// action into a coarse phase so consecutive events coalesce into one collapsible
// step — "Thinking", "Coding components", "Designing", etc.

type StepPhase =
  | 'thinking'
  | 'planning'
  | 'logic'
  | 'backend'
  | 'components'
  | 'design'
  | 'images'
  | 'validating'
  | 'assembling'
  | 'saving'
  | 'deploying';

interface PhaseMeta {
  label: string;
  icon: LucideIcon;
  tint: string;
}

const PHASES: Record<StepPhase, PhaseMeta> = {
  thinking: { label: 'Thinking', icon: Brain, tint: 'text-violet-500' },
  planning: { label: 'Planning', icon: ClipboardList, tint: 'text-sky-500' },
  logic: { label: 'Wiring logic', icon: Workflow, tint: 'text-amber-500' },
  backend: { label: 'Building backend', icon: Database, tint: 'text-emerald-500' },
  components: { label: 'Coding components', icon: Blocks, tint: 'text-blue-500' },
  design: { label: 'Designing', icon: Palette, tint: 'text-pink-500' },
  images: { label: 'Finding images', icon: ImageIcon, tint: 'text-fuchsia-500' },
  validating: { label: 'Validating', icon: ShieldCheck, tint: 'text-teal-500' },
  assembling: { label: 'Assembling', icon: Package, tint: 'text-indigo-500' },
  saving: { label: 'Saving', icon: Save, tint: 'text-cyan-500' },
  deploying: { label: 'Deploying', icon: Rocket, tint: 'text-orange-500' },
};

const ACTION_PHASE: Record<string, StepPhase> = {
  analyzing_request: 'thinking',
  investigating: 'thinking',
  message: 'thinking',
  help_desk: 'thinking',
  planning: 'planning',
  creation_mode_starting: 'planning',
  app_building_started: 'planning',
  app_editing_started: 'planning',
  direct_action_started: 'planning',
  building_pre_build: 'planning',
  building_logic: 'logic',
  building_backend: 'backend',
  building_components: 'components',
  building_component: 'components',
  building_theme: 'design',
  adopting_imported_theme: 'design',
  importing_design_bundle: 'design',
  design_bundle_imported: 'design',
  resolving_images: 'images',
  validating: 'validating',
  assembling: 'assembling',
  saving: 'saving',
};

function phaseForAction(action: string): StepPhase {
  const exact = ACTION_PHASE[action];
  if (exact) return exact;
  if (action.includes('theme') || action.includes('design')) return 'design';
  if (action.includes('backend')) return 'backend';
  if (action.includes('component')) return 'components';
  if (action.includes('valid')) return 'validating';
  if (action.includes('sav')) return 'saving';
  if (action.includes('plan')) return 'planning';
  if (action.includes('deploy')) return 'deploying';
  return 'thinking';
}

type Entry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'answer'; text: string }
  | { id: number; kind: 'status'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'step'; phase: StepPhase; label: string; lines: string[]; active: boolean };

type StepEntry = Extract<Entry, { kind: 'step' }>;

const strOf = (...vals: unknown[]): string => {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
};

type EventResult =
  | { kind: 'step'; phase: StepPhase; text: string }
  | { kind: 'user' | 'answer' | 'status' | 'error'; text: string }
  | null;

/** Map a raw agent SSE payload to a single timeline action. */
function classifyEvent(e: StudioEvent): EventResult {
  switch (e.type) {
    // The server records the user's prompt as the first event of each turn, so
    // history replay + build reconnect reconstruct the user bubble.
    case 'user_prompt':
      return { kind: 'user', text: strOf(e.text) };
    case 'progress': {
      const action = String(e.action ?? '');
      if (action === 'error')
        return { kind: 'error', text: strOf(e.internal_message) || 'Something went wrong.' };
      // Completion is already conveyed by the deploy "Preview is live." status
      // (builds) or by the answer itself (Q&A turns) — a redundant "Build
      // complete." line just adds noise, and reads oddly after a casual reply.
      if (action === 'app_building_finished') return null;
      const phase = phaseForAction(action);
      return { kind: 'step', phase, text: strOf(e.internal_message) || PHASES[phase].label };
    }
    case 'chat_message':
      return { kind: 'answer', text: strOf(e.text, e.message, e.content) };
    case 'deploy_status': {
      const status = String(e.status ?? '');
      if (status === 'deploying')
        return { kind: 'step', phase: 'deploying', text: 'Deploying preview…' };
      if (status === 'success') return { kind: 'status', text: 'Preview is live.' };
      if (status === 'failed')
        return { kind: 'error', text: `Deploy failed: ${strOf(e.error) || 'unknown error'}` };
      return null;
    }
    case 'backend_response': {
      const cb = e.callback_data as Record<string, unknown> | undefined;
      const status = (cb?.status as string) ?? (e.status as string);
      if (status === 'failed') return { kind: 'error', text: 'The agent reported a failure.' };
      return null;
    }
    default:
      return null;
  }
}

/** Ids are append-only, so the last entry always holds the max id. */
const nextId = (entries: Entry[]): number =>
  entries.length ? entries[entries.length - 1].id + 1 : 1;

const closeActiveSteps = (entries: Entry[]): Entry[] =>
  entries.map((en) => (en.kind === 'step' && en.active ? { ...en, active: false } : en));

/** Fold an event into the timeline, coalescing consecutive same-phase steps. */
function reduceTimeline(prev: Entry[], e: StudioEvent): Entry[] {
  const r = classifyEvent(e);
  if (!r || !r.text) return prev;

  if (r.kind === 'step') {
    const last = prev[prev.length - 1];
    if (last && last.kind === 'step' && last.phase === r.phase) {
      // Same phase still running — append the new line (drop consecutive dupes).
      const lines =
        last.lines[last.lines.length - 1] === r.text ? last.lines : [...last.lines, r.text];
      return [...prev.slice(0, -1), { ...last, lines, active: true }];
    }
    const closed = closeActiveSteps(prev);
    return [
      ...closed,
      {
        id: nextId(closed),
        kind: 'step',
        phase: r.phase,
        label: PHASES[r.phase].label,
        lines: [r.text],
        active: true,
      },
    ];
  }

  const closed = closeActiveSteps(prev);
  return [...closed, { id: nextId(closed), kind: r.kind, text: r.text }];
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] overflow-hidden whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

function AnswerBlock({ text }: { text: string }) {
  return (
    <div className="flex gap-2">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {text}
      </div>
    </div>
  );
}

function StatusLine({ kind, text }: { kind: 'status' | 'error'; text: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs',
        kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {kind === 'error' ? (
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 self-start" />
      ) : (
        <span className="mt-1 h-1.5 w-1.5 shrink-0 self-start rounded-full bg-emerald-500" />
      )}
      <span className="min-w-0 break-words font-medium">{text}</span>
    </div>
  );
}

function StepBlock({
  step,
  expanded,
  onToggle,
}: {
  step: StepEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = PHASES[step.phase];
  const Icon = meta.icon;
  const last = step.lines[step.lines.length - 1] ?? '';
  const panelId = `step-panel-${step.id}`;
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center', meta.tint)}>
          {step.active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          {/* Truncates (rather than forcing the row wider than the panel) when
              the chat panel is dragged narrow; shows fully when there's room. */}
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{meta.label}</span>
          {!expanded && last && (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{last}</span>
          )}
        </span>
        {step.lines.length > 1 && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
            {step.lines.length}
          </span>
        )}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <ul id={panelId} className="space-y-1 border-t border-border/60 py-1.5 pl-9 pr-2.5">
          {step.lines.map((line, i) => (
            <li key={i} className="break-words text-xs leading-relaxed text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Publish settings ─────────────────────────────────────────────────────────
//
// Rendered inline as the third right-panel tab (alongside Preview/Admin), not a
// modal. Three destinations; only **Self-host** is wired today — it runs the
// existing in-instance publish (`/api/orchestrate/.../publish` → `/a/{appId}/`).
// "Share live URL" (ephemeral exepad.live tunnel) and "Exepad Cloud" (managed)
// are placeholders pending design.

function PublishOptionCard({
  icon: Icon,
  title,
  badge,
  description,
  disabled,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge?: { label: string; tone: 'available' | 'soon' };
  description: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border p-4 transition-colors',
        disabled ? 'opacity-65' : 'bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <Icon className="h-[18px] w-[18px] text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {badge && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  badge.tone === 'available'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {badge.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function PublishPanel({
  appId,
  previewReady,
  running,
  publishing,
  unpublishing,
  publishedUrl,
  error,
  onPublish,
  onUnpublish,
  tunnelStatus,
  tunnelUrl,
  tunnelError,
  tunnelAppId,
  onTunnelStart,
  onTunnelStop,
}: {
  appId: string | null;
  previewReady: boolean;
  running: boolean;
  publishing: boolean;
  unpublishing: boolean;
  publishedUrl: string | null;
  error: string | null;
  onPublish: () => void;
  onUnpublish: () => void;
  tunnelStatus: TunnelStatus;
  tunnelUrl: string | null;
  tunnelError: string | null;
  tunnelAppId: string | null;
  onTunnelStart: () => void;
  onTunnelStop: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [tunnelCopied, setTunnelCopied] = useState(false);

  async function copyTunnelUrl() {
    // The tunnel URL is already an absolute https:// URL — do NOT wrap it in
    // new URL(_, origin) like the relative self-host URL below.
    if (!tunnelUrl) return;
    try {
      await navigator.clipboard.writeText(tunnelUrl);
      setTunnelCopied(true);
      window.setTimeout(() => setTunnelCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  const absoluteUrl = resolvePublishedAppUrl(publishedUrl);

  async function copyUrl() {
    if (!absoluteUrl) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / denied) — silently no-op */
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">Publish</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose how to share this app.</p>
      </div>
      <div className="space-y-3">
        {/* Self-host — the only wired path today. */}
        <PublishOptionCard
          icon={Server}
          title="Self-host"
          badge={{ label: 'Available', tone: 'available' }}
          description="Publish on this instance. The app and its data stay on your own server, served from this container."
        >
          {publishedUrl ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={absoluteUrl ?? publishedUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Published URL"
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyUrl}
                  className="shrink-0"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
                </Button>
                <Button type="button" variant="outline" size="sm" asChild className="shrink-0">
                  <a
                    href={absoluteUrl ?? publishedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Open</span>
                  </a>
                </Button>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={publishing || running || !previewReady}
                onClick={onPublish}
                className="w-full"
              >
                {publishing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Republishing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" /> Republish latest build
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={publishing || unpublishing}
                onClick={onUnpublish}
                className="w-full text-destructive hover:text-destructive"
              >
                {unpublishing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Taking offline…
                  </>
                ) : (
                  <>
                    <PowerOff className="h-3.5 w-3.5" /> Unpublish (take offline)
                  </>
                )}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={publishing || running || !previewReady || !appId}
              onClick={onPublish}
              className="w-full"
            >
              {publishing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Publishing…
                </>
              ) : (
                <>
                  <Globe className="h-3.5 w-3.5" /> Publish to this instance
                </>
              )}
            </Button>
          )}
          {running ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Finish the current build to publish.
            </p>
          ) : !previewReady ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Build the app first to publish it.
            </p>
          ) : null}
          {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
        </PublishOptionCard>

        {/* Custom domain — point YOUR domain at THIS app (per-app, app_id-pinned). */}
        <PublishOptionCard
          icon={Globe}
          title="Custom domain"
          badge={{ label: 'Available', tone: 'available' }}
          description="Point your own domain (or a subdomain) at this app, with an automatic browser-trusted certificate — for example crm.example.com. It serves this app at the address's root."
        >
          {appId ? (
            <AppDomainSection appId={appId} published={Boolean(publishedUrl)} />
          ) : (
            <p className="text-[11px] text-muted-foreground">Create the app first.</p>
          )}
        </PublishOptionCard>

        {/* Share live URL — ephemeral Cloudflare Quick Tunnel (*.trycloudflare.com). */}
        <PublishOptionCard
          icon={Share2}
          title="Share live URL"
          badge={{ label: 'Available', tone: 'available' }}
          description="Get a temporary public link to share this running app with anyone — no deploy, no account. The app and its data stay on this machine; the link only proxies traffic and dies when you stop sharing or the instance restarts."
        >
          {tunnelStatus === 'live' && tunnelUrl ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={tunnelUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Public share URL"
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                <Button type="button" variant="outline" size="sm" onClick={copyTunnelUrl} className="shrink-0">
                  {tunnelCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{tunnelCopied ? 'Copied' : 'Copy'}</span>
                </Button>
                <Button type="button" variant="outline" size="sm" asChild className="shrink-0">
                  <a href={tunnelUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Open</span>
                  </a>
                </Button>
              </div>
              <Button type="button" variant="destructive" size="sm" onClick={onTunnelStop} className="w-full">
                <Square className="h-3.5 w-3.5" /> Stop sharing
              </Button>
              <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <CircleAlert className="mt-px h-3 w-3 shrink-0" />
                <span>
                  Anyone with this link can use the app and its real data. It’s a temporary demo link
                  (no SLA, ~200 concurrent requests), the address changes each time, and it stops when
                  you click Stop or the instance restarts.
                </span>
              </p>
            </div>
          ) : tunnelStatus === 'starting' || tunnelStatus === 'stopping' ? (
            <Button type="button" size="sm" disabled className="w-full">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {tunnelStatus === 'starting' ? 'Creating public link…' : 'Stopping…'}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={running || !previewReady || !appId || !publishedUrl}
              onClick={onTunnelStart}
              className="w-full"
            >
              <Share2 className="h-3.5 w-3.5" /> Create public link
            </Button>
          )}
          {tunnelStatus !== 'live' &&
            (running ? (
              <p className="mt-2 text-[11px] text-muted-foreground">Finish the current build first.</p>
            ) : !previewReady ? (
              <p className="mt-2 text-[11px] text-muted-foreground">Build the app first to share it.</p>
            ) : !publishedUrl ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Publish to this instance first, then share a live link.
              </p>
            ) : null)}
          {tunnelError && tunnelStatus !== 'live' && (
            <p className="mt-2 text-[11px] text-destructive">{tunnelError}</p>
          )}
          {tunnelAppId && appId && tunnelAppId !== appId && tunnelStatus === 'live' && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              A different app is currently being shared. Stop it to share this one.
            </p>
          )}
        </PublishOptionCard>

        {/* Exepad Cloud — managed hosting (not yet built). */}
        <PublishOptionCard
          icon={Cloud}
          title="Exepad Cloud"
          badge={{ label: 'Coming soon', tone: 'soon' }}
          description="Deploy to managed Exepad Cloud for a permanent, always-on URL with automatic HTTPS, backups, and custom domains."
          disabled
        />
      </div>
    </div>
  );
}

export default function StudioPage() {
  const navigate = useNavigate();
  const params = useParams();
  const routeAppId = params.appId ?? null;

  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [timeline, setTimeline] = useState<Entry[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [appId, setAppId] = useState<string | null>(routeAppId);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Ephemeral "Share live URL" (Cloudflare Quick Tunnel). A status union, not a
  // boolean: start is two-step (POST returns, then the SSE reports the URL).
  const [tunnel, setTunnel] = useState<{
    status: TunnelStatus;
    url: string | null;
    error: string | null;
    sharedAppId: string | null;
  }>({ status: 'idle', url: null, error: null, sharedAppId: null });
  const [hasExistingApp, setHasExistingApp] = useState(false);
  const [rightTab, setRightTab] = useState<'preview' | 'admin' | 'publish' | 'source'>('preview');
  const [device, setDevice] = useState<Device>('desktop');
  const [showChat, setShowChat] = useState(true);
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [restoring, setRestoring] = useState(false);
  // Below the md breakpoint the chat + preview can't share a row — we collapse
  // to a single full-width panel toggled by the Agent button instead of the
  // side-by-side resizable split.
  const isMobile = useIsMobile();

  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reconnectAbortRef = useRef<AbortController | null>(null);
  const tunnelAbortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  // Scale factor for the tablet/mobile device-frame preview: the iframe renders
  // at the device's true pixel size and is scaled to fit the preview pane.
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const [frameScale, setFrameScale] = useState(1);
  // Guards setState after the component unmounts (a build's `handle.done` can
  // resolve post-unmount when the stream is aborted in cleanup).
  const isMountedRef = useRef(true);
  // Highest event seq folded into the timeline. Server events carry a monotonic
  // `__seq`; this de-dupes the overlap between the persisted history a fresh
  // mount loads and the live build buffer it replays on reconnect.
  const lastSeqRef = useRef(-1);
  // Mirror of `appId` for use inside stable callbacks without stale closures.
  const appIdRef = useRef<string | null>(routeAppId);
  useEffect(() => {
    appIdRef.current = appId;
  }, [appId]);

  // Fold a server event into the timeline, de-duplicating by `__seq` so the same
  // event delivered via both history replay and the live stream lands once.
  const applyTimelineEvent = useCallback((event: StudioEvent) => {
    const seq = typeof event.__seq === 'number' ? event.__seq : null;
    if (seq !== null) {
      if (seq <= lastSeqRef.current) return;
      lastSeqRef.current = seq;
    }
    setTimeline((prev) => reduceTimeline(prev, event));
  }, []);

  // Preview-side effects of a LIVE event (skipped during history replay — a
  // reloaded preview is already set from getApp's deploy snapshot).
  const applyLiveSideEffects = useCallback((event: StudioEvent) => {
    if (event.type === 'page_reload' || event.type === 'app_config_updated') {
      if (appIdRef.current) setPreviewNonce((n) => n + 1);
    }
    if (event.type === 'deploy_status' && event.status === 'success') {
      if (typeof event.appId === 'string') setAppId(event.appId);
      setPreviewReady(true);
      setPreviewNonce((n) => n + 1);
      setHasExistingApp(true);
    }
  }, []);

  // Auth guard + load existing app (edit mode).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await authMe();
      if (cancelled) return;
      if (!user) {
        navigate('/login', { replace: true });
        return;
      }
      if (routeAppId) {
        const detail = await getApp(routeAppId);
        if (!cancelled && detail) {
          setAppId(detail.app.id);
          setHasExistingApp(true);
          if (detail.app.publishedUrl) setPublishedUrl(detail.app.publishedUrl);
          if (detail.preview) {
            setPreviewReady(true);
            setPreviewNonce((n) => n + 1);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, routeAppId]);

  // Load persisted chat history and re-attach to any build still running for
  // this app. This is what makes a build survive leaving + returning to the page
  // (the build runs server-side regardless of the connection) and what restores
  // the conversation on a fresh open.
  useEffect(() => {
    if (!routeAppId) return;
    // Reset per-app: a different app (or a StrictMode re-run) must replay its
    // history from scratch, not de-dupe against the prior app's seq cursor.
    lastSeqRef.current = -1;
    setTimeline([]);
    const controller = new AbortController();
    reconnectAbortRef.current = controller;
    let replaying = true;
    void streamChat(
      routeAppId,
      (event) => {
        if (event.type === 'chat_state') {
          if (typeof event.sessionId === 'string') sessionIdRef.current = event.sessionId;
          // Only flip ON here (a live build is in progress). The stream-close
          // `finally` flips OFF unconditionally — so this can't clobber the
          // `running` of a build the user just started locally, and a StrictMode
          // remount can't strand the UI at 'Building…'.
          if (event.running) setRunning(true);
          return;
        }
        if (event.type === 'chat_history_end') {
          replaying = false;
          return;
        }
        if (!replaying) applyLiveSideEffects(event);
        applyTimelineEvent(event);
      },
      controller.signal,
    ).finally(() => {
      if (controller.signal.aborted) return; // navigated away — leave state alone
      // Stream ended: fold any spinning step and clear the building state. For a
      // history-only app this runs right after replay; for a live build, when it
      // finishes. Unconditional so a StrictMode remount can't strand 'Building…'.
      setTimeline(closeActiveSteps);
      setRunning(false);
      if (reconnectAbortRef.current === controller) reconnectAbortRef.current = null;
    });
    return () => controller.abort();
  }, [routeAppId, applyLiveSideEffects, applyTimelineEvent]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline]);

  // Abort an in-flight build stream on unmount. Safe now that builds are
  // decoupled from the connection — this only detaches the client; the build
  // keeps running server-side and is re-attached on the next mount. The setup
  // re-arms isMountedRef so a StrictMode mount→unmount→mount leaves it `true`.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  function pushEntry(entry: { kind: 'user' | 'answer' | 'status' | 'error'; text: string }) {
    if (!entry.text) return;
    setTimeline((prev) => [...prev, { id: nextId(prev), ...entry }]);
  }

  // Expanded by default while a step is active; collapses ("folds") when done.
  // A click pins the opposite of whatever is currently showing.
  const toggleStep = (id: number, active: boolean) =>
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? active) }));

  async function submitPrompt() {
    const text = prompt.trim();
    if (running || !text) return;
    setRunning(true);
    setPublishedUrl(null);
    setPrompt('');
    // The user bubble is no longer added optimistically — the server records the
    // prompt as the turn's first event (with a seq) and streams it back, so it
    // renders identically on the live build and on a later reload/reconnect.

    const controller = new AbortController();
    abortRef.current = controller;

    const handle = await runBuild(
      {
        prompt: text,
        appId: appId ?? undefined,
        operationMode: hasExistingApp ? 'edit' : undefined,
      },
      (event) => {
        applyLiveSideEffects(event);
        applyTimelineEvent(event);
      },
      controller.signal,
    );

    sessionIdRef.current = handle.sessionId;
    if (handle.appId && !appId) setAppId(handle.appId);

    await handle.done;
    abortRef.current = null;
    // The stream can end because the component unmounted (its cleanup aborts the
    // fetch); the build keeps running server-side and is re-attached on remount,
    // so don't touch the (gone) state here.
    if (!isMountedRef.current) return;
    setTimeline(closeActiveSteps);
    setRunning(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submitPrompt();
  }

  // Enter sends; Shift+Enter inserts a newline. Guard IME composition so
  // mid-composition Enter (CJK) doesn't fire a build.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submitPrompt();
    }
  }

  async function handleCancel() {
    // Abort first so the SSE loop stops feeding reduceTimeline, then fold any
    // spinning steps and record the cancellation in the same update — otherwise
    // a step left active:true keeps spinning under the "Build cancelled." line
    // until the (awaited) network cancel and handle.done resolve.
    abortRef.current?.abort();
    setRunning(false);
    setTimeline((prev) => [
      ...closeActiveSteps(prev),
      { id: nextId(prev), kind: 'status', text: 'Build cancelled.' },
    ]);
    if (sessionIdRef.current) await cancelRun(sessionIdRef.current);
  }

  async function handlePublish() {
    if (!appId || publishing) return;
    setPublishing(true);
    setPublishError(null);
    pushEntry({ kind: 'status', text: 'Publishing…' });
    const result = await publishApp(appId);
    setPublishing(false);
    if (result.ok && result.url) {
      setPublishedUrl(result.url);
      pushEntry({ kind: 'status', text: 'Published.' });
    } else {
      const message = result.error || 'unknown error';
      setPublishError(message);
      pushEntry({ kind: 'error', text: `Publish failed: ${message}` });
    }
  }

  async function handleUnpublish() {
    if (!appId || unpublishing) return;
    setUnpublishing(true);
    setPublishError(null);
    pushEntry({ kind: 'status', text: 'Taking the live app offline…' });
    const result = await unpublishApp(appId);
    setUnpublishing(false);
    if (result.ok) {
      // Server stopped any tunnel + removed the published pointer — reflect the
      // app as no longer live so the panel returns to its "Publish" state.
      setPublishedUrl(null);
      pushEntry({ kind: 'status', text: 'App unpublished — the live URL is now offline.' });
    } else {
      const message = result.error || 'unknown error';
      setPublishError(message);
      pushEntry({ kind: 'error', text: `Unpublish failed: ${message}` });
    }
  }

  // Subscribe to the tunnel status stream (idempotent). Opened on mount to
  // re-attach to an already-live share after a reload/logout, and again on start.
  const attachTunnelStatus = useCallback(() => {
    if (tunnelAbortRef.current) return;
    const controller = new AbortController();
    tunnelAbortRef.current = controller;
    void streamTunnelStatus(
      (e) => {
        setTunnel((t) => ({
          status: e.status ?? t.status,
          url: e.url !== undefined ? e.url : t.url,
          error: e.error !== undefined ? e.error : t.error,
          sharedAppId: e.appId !== undefined ? e.appId : t.sharedAppId,
        }));
      },
      controller.signal,
    ).finally(() => {
      if (tunnelAbortRef.current === controller) tunnelAbortRef.current = null;
    });
  }, []);

  useEffect(() => {
    attachTunnelStatus();
    return () => {
      tunnelAbortRef.current?.abort();
      tunnelAbortRef.current = null;
    };
  }, [attachTunnelStatus]);

  async function handleTunnelStart() {
    if (!appId || tunnel.status === 'starting' || tunnel.status === 'live') return;
    setTunnel((t) => ({ ...t, status: 'starting', error: null, sharedAppId: appId }));
    pushEntry({ kind: 'status', text: 'Starting public share link…' });
    attachTunnelStatus();
    const result = await startTunnel(appId);
    if (!result.ok) {
      const message = result.error || 'unknown error';
      setTunnel((t) => ({ ...t, status: 'error', error: message }));
      pushEntry({ kind: 'error', text: `Share failed: ${message}` });
      return;
    }
    if (result.url) {
      setTunnel((t) => ({ ...t, status: 'live', url: result.url ?? t.url }));
      pushEntry({ kind: 'status', text: 'Public link is live.' });
    }
  }

  async function handleTunnelStop() {
    setTunnel((t) => ({ ...t, status: 'stopping' }));
    await stopTunnel();
    setTunnel({ status: 'idle', url: null, error: null, sharedAppId: null });
    pushEntry({ kind: 'status', text: 'Stopped sharing.' });
  }

  const loadVersions = useCallback(
    async (id: string | null = appId) => {
      if (!id) return;
      setVersions(await listVersions(id));
    },
    [appId],
  );

  // Keep the timeline fresh for the prev/next stepper without needing the
  // dropdown open: reload after the initial load and after each build/restore.
  useEffect(() => {
    if (appId && previewReady) void loadVersions(appId);
  }, [appId, previewReady, previewNonce, loadVersions]);

  async function handleRestore(versionId: number) {
    if (!appId || restoring || running) return;
    setRestoring(true);
    pushEntry({ kind: 'status', text: 'Restoring version…' });
    const res = await restoreVersion(appId, versionId);
    setRestoring(false);
    if (res.ok) {
      setRightTab('preview');
      setPreviewReady(true);
      setPreviewNonce((n) => n + 1);
      pushEntry({ kind: 'status', text: 'Switched to the selected version.' });
      void loadVersions();
    } else {
      pushEntry({ kind: 'error', text: `Restore failed: ${res.error || 'unknown error'}` });
    }
  }

  const previewSrc =
    appId && previewReady ? `/a/preview-${appId}/?_studio=${previewNonce}` : null;
  const canAdmin = Boolean(appId && (previewReady || hasExistingApp));
  const showAdmin = rightTab === 'admin';
  const showPublish = rightTab === 'publish';
  const showSource = rightTab === 'source';

  // Scale the device-frame preview to fit the pane: render the iframe at the
  // device's true pixel size, then shrink it with a transform so the real device
  // layout shows even when the pane (or window) is narrower. Re-measures on any
  // layout change (panel drag, tab switch, mobile toggle) via ResizeObserver.
  const deviceDims = DEVICES[device].dims;
  useEffect(() => {
    const el = previewFrameRef.current;
    if (!deviceDims || !el || showAdmin || showPublish || showSource || !previewSrc) {
      setFrameScale(1);
      return;
    }
    const measure = () => {
      const pad = 32; // p-4 on the frame container (16px each side)
      const availW = Math.max(0, el.clientWidth - pad);
      const availH = Math.max(0, el.clientHeight - pad);
      const s = Math.min(1, availW / deviceDims.w, availH / deviceDims.h);
      setFrameScale(s > 0 && Number.isFinite(s) ? s : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [deviceDims, showAdmin, showPublish, showSource, previewSrc, showChat, isMobile]);

  // Left status pill (mirrors the pro "Agent" indicator).
  const status = running
    ? { dot: 'bg-amber-500 animate-pulse', label: 'Building…' }
    : previewReady
      ? { dot: 'bg-emerald-500', label: 'Live preview' }
      : { dot: 'bg-muted-foreground/40', label: 'Draft' };

  const DeviceIcon = DEVICES[device].icon;

  // Panel bodies are extracted so the same markup serves both the desktop
  // side-by-side resizable split and the mobile single-panel toggle.
  const chatPanelBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
        <span className="text-xs font-medium text-foreground">
          {running ? 'Building…' : 'Build assistant'}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {/* Radix ScrollArea renders its content in a `display:table; min-width:100%`
            div, which sizes to the content's natural width and overflows the panel
            horizontally when it's dragged narrow (clipping step rows + text). Force
            that inner div to block so content wraps to the panel width — `!` beats
            Radix's inline style. */}
        <ScrollArea className="h-full [&_[data-radix-scroll-area-viewport]>div]:!block">
          <div
            className="space-y-2 px-4 py-3"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={running}
            aria-label="Build progress"
          >
            {timeline.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Describe the app you want to build. The agent will plan it, build the components
                and backend, then deploy a live preview.
              </p>
            )}
            {timeline.map((entry) => {
              if (entry.kind === 'user') return <UserBubble key={entry.id} text={entry.text} />;
              if (entry.kind === 'answer') return <AnswerBlock key={entry.id} text={entry.text} />;
              if (entry.kind === 'step') {
                return (
                  <StepBlock
                    key={entry.id}
                    step={entry}
                    expanded={expanded[entry.id] ?? entry.active}
                    onToggle={() => toggleStep(entry.id, entry.active)}
                  />
                );
              }
              return <StatusLine key={entry.id} kind={entry.kind} text={entry.text} />;
            })}
            <div ref={logEndRef} />
          </div>
        </ScrollArea>
      </div>

      {running && (
        <div className="h-0.5 w-full overflow-hidden bg-muted">
          <div className="animate-shimmer h-full w-1/3 bg-primary" />
          <span className="sr-only">Building…</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        <div className="relative">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
            aria-label="Describe the app to build"
            placeholder={hasExistingApp ? 'Describe a change to this app…' : 'Write your prompt…'}
            rows={3}
            // The placeholder disappears the moment the field is focused (not just
            // on first keystroke) — `focus:placeholder:text-transparent` clears it
            // on activation so the user starts from a clean field.
            className="resize-none pr-12 focus:placeholder:text-transparent"
          />
          {!running ? (
            <button
              type="submit"
              disabled={!prompt.trim()}
              aria-label="Send message"
              className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCancel}
              aria-label="Stop build"
              className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground">
          {running ? (
            'Build in progress — Enter is paused until it finishes.'
          ) : (
            <>
              <kbd className="rounded border border-border bg-muted px-1 font-sans">Enter</kbd> to
              send ·{' '}
              <kbd className="rounded border border-border bg-muted px-1 font-sans">Shift+Enter</kbd>{' '}
              for a new line
            </>
          )}
        </p>
      </form>
    </div>
  );

  const previewPanelBody = (
    <div className="relative h-full min-h-0 bg-muted/30">
      {/* Preview stays mounted so it survives the Admin/Publish switch. */}
      <div className={cn('absolute inset-0', (showAdmin || showPublish || showSource) && 'hidden')}>
        {previewSrc ? (
          !deviceDims ? (
            <iframe
              key={previewNonce}
              src={previewSrc}
              title="App preview"
              className="h-full w-full border-0 bg-background"
            />
          ) : (
            // Render at the device's true pixel size and scale to fit the pane,
            // centered. `min-w-0` lets the container shrink in a narrow split;
            // `overflow-hidden` clips the absolutely-placed frame's footprint.
            <div ref={previewFrameRef} className="relative h-full min-w-0 overflow-hidden p-4">
              <div
                className="absolute left-1/2 top-1/2 overflow-hidden rounded-xl border border-border bg-background shadow-sm"
                style={{
                  width: deviceDims.w,
                  height: deviceDims.h,
                  transform: `translate(-50%, -50%) scale(${frameScale})`,
                }}
              >
                <iframe
                  key={previewNonce}
                  src={previewSrc}
                  title="App preview"
                  className="h-full w-full border-0 bg-background"
                />
              </div>
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-muted-foreground">
              {running ? 'Building your app…' : 'Your preview will appear here.'}
            </p>
          </div>
        )}
      </div>
      {showAdmin && appId && (
        <div className="absolute inset-0 overflow-auto bg-background">
          <AdminPanel appId={appId} />
        </div>
      )}
      {showPublish && (
        <div className="absolute inset-0 overflow-auto bg-background">
          <PublishPanel
            appId={appId}
            previewReady={previewReady}
            running={running}
            publishing={publishing}
            unpublishing={unpublishing}
            publishedUrl={publishedUrl}
            error={publishError}
            onPublish={handlePublish}
            onUnpublish={handleUnpublish}
            tunnelStatus={tunnel.status}
            tunnelUrl={tunnel.url}
            tunnelError={tunnel.error}
            tunnelAppId={tunnel.sharedAppId}
            onTunnelStart={handleTunnelStart}
            onTunnelStop={handleTunnelStop}
          />
        </div>
      )}
      {showSource && appId && (
        <div className="absolute inset-0 overflow-hidden bg-background">
          <SourcePanel appId={appId} />
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top toolbar */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        {/* Left: back to apps + brand + agent/build status */}
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                <Link to="/apps" aria-label="Back to apps">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Back to apps
            </TooltipContent>
          </Tooltip>
          <Logo size="sm" iconOnly={isMobile} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setShowChat((v) => !v)}
                aria-pressed={showChat}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  showChat
                    ? 'border-border bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
                Agent
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {showChat ? 'Hide the agent panel' : 'Show the agent panel'} · {status.label}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Center: secondary preview controls (refresh, open, device size,
            version history). Hidden below md (phones); the device label
            collapses to an icon below lg so nothing overflows when the
            side-by-side panels are cramped. */}
        <div className="hidden items-center gap-1 md:flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!previewSrc}
                onClick={() => setPreviewNonce((n) => n + 1)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Refresh preview
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!previewSrc}
                asChild
              >
                <a href={previewSrc ?? '#'} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Open in new tab
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <Tooltip>
              {/* span gives the tooltip its own anchor node — Radix can't compose
                  refs when TooltipTrigger + DropdownMenuTrigger both Slot one node. */}
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8">
                      <DeviceIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Preview device size
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="center">
              {(Object.keys(DEVICES) as Device[]).map((d) => {
                const Icon = DEVICES[d].icon;
                return (
                  <DropdownMenuItem
                    key={d}
                    className="cursor-pointer"
                    onClick={() => setDevice(d)}
                  >
                    <Icon />
                    {DEVICES[d].label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Version history — open the timeline to jump to any saved version. */}
          <DropdownMenu onOpenChange={(open) => open && loadVersions()}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!appId}>
                      {restoring ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <History className="h-4 w-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Version history
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              align="center"
              className="max-h-80 w-72 max-w-[calc(100vw-1rem)] overflow-auto"
            >
              {versions.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No versions yet — build the app first.
                </div>
              ) : (
                versions.map((v) => (
                  <DropdownMenuItem
                    key={v.id}
                    className="cursor-pointer gap-2"
                    disabled={restoring || v.current}
                    onClick={() => handleRestore(v.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {v.label || `Version ${v.id}`}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {relTime(v.createdAt)}
                      </span>
                    </span>
                    {v.current && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right: preview / admin / publish tabs */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border p-0.5 text-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setRightTab('preview')}
                  className={cn(
                    'cursor-pointer rounded-sm px-2.5 py-1 font-medium transition-colors',
                    rightTab === 'preview'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Preview
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Live app preview
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-disabled={!canAdmin}
                  onClick={() => canAdmin && setRightTab('admin')}
                  className={cn(
                    'rounded-sm px-2.5 py-1 font-medium transition-colors',
                    rightTab === 'admin'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    canAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                  )}
                >
                  Admin
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {canAdmin ? 'Manage app data & users' : 'Build the app first to manage it'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-disabled={!canAdmin}
                  onClick={() => canAdmin && setRightTab('source')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-medium transition-colors',
                    rightTab === 'source'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    canAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                  )}
                >
                  <Code2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Source</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {canAdmin ? 'Browse & download the app source code' : 'Build the app first to view its source'}
              </TooltipContent>
            </Tooltip>
            {/* A thin divider sets Publish apart from the Preview/Admin/Source
                view tabs while keeping them in one segmented control. */}
            <div className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-disabled={!appId}
                  onClick={() => appId && setRightTab('publish')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-medium transition-colors',
                    rightTab === 'publish'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    appId ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                  )}
                >
                  <span className="relative inline-flex">
                    <Globe className="h-4 w-4" />
                    {publishedUrl && (
                      <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-background" />
                    )}
                  </span>
                  <span className="hidden sm:inline">{publishedUrl ? 'Published' : 'Publish'}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {appId ? 'Publish & sharing options' : 'Build the app first to publish'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      {isMobile ? (
        /* Mobile: one full-width panel at a time; the Agent button toggles
           between the chat and the preview/admin view. Both stay mounted so
           the preview iframe survives the switch. */
        <div className="relative min-h-0 flex-1">
          <div className={cn('absolute inset-0', !showChat && 'hidden')}>{chatPanelBody}</div>
          <div className={cn('absolute inset-0', showChat && 'hidden')}>{previewPanelBody}</div>
        </div>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          {/* Left: prompt + activity timeline — toggled by the Agent button */}
          {showChat && (
            <>
              <ResizablePanel
                id="chat"
                order={1}
                defaultSize={24}
                minSize={18}
                maxSize={45}
                className="flex flex-col"
              >
                {chatPanelBody}
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          {/* Right: preview / admin content — switched from the toolbar */}
          <ResizablePanel id="preview" order={2} defaultSize={76} className="min-w-0">
            {previewPanelBody}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
    </TooltipProvider>
  );
}
