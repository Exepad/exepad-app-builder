/**
 * Read-only source-code browser for a generated app.
 *
 * Left: a file tree of the app's source (config-referenced files only — the
 * server excludes compiled output, snapshots, and orphaned files from prior
 * builds). Right: a read-only viewer for the selected file. Header: a
 * "Download source (.zip)" anchor that hits the server-side zip route.
 *
 * This is deliberately NOT an editor — it mirrors the source the agent wrote so
 * an owner can read and export it. It is not a standalone runnable project (the
 * code depends on Exepad's SDK + runtime), which the disclaimer makes explicit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Package,
  Rocket,
} from 'lucide-react';
import { CodeView } from './CodeView';
import {
  listSource,
  getSourceFile,
  sourceZipUrl,
  exportZipUrl,
  type SourceFileEntry,
} from '../../services/AdminApi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { btn, Spinner, EmptyState, ErrorBanner } from './ui';

// ── Download options (single dropdown) ───────────────────────────
type DownloadKind = 'deployable' | 'source' | 'handover' | 'mirror';
interface DownloadOption {
  kind: DownloadKind;
  label: string;
  desc: string;
  Icon: typeof Rocket;
  url: (appId: string) => string;
}
const DOWNLOAD_OPTIONS: DownloadOption[] = [
  {
    kind: 'deployable',
    label: 'Deployable package',
    desc: 'Run-ready bundle — docker compose up on any VPS',
    Icon: Rocket,
    url: (id) => exportZipUrl(id, 'deployable'),
  },
  {
    kind: 'source',
    label: 'Buildable project',
    desc: 'Full-stack source you build & host yourself',
    Icon: Package,
    url: (id) => exportZipUrl(id, 'source'),
  },
  {
    kind: 'handover',
    label: 'Handover kit',
    desc: 'Source + spec for a coding agent (Cursor/Claude Code)',
    Icon: Bot,
    url: (id) => exportZipUrl(id, 'handover'),
  },
  {
    kind: 'mirror',
    label: 'Source mirror',
    desc: 'Read-only copy of the files shown here',
    Icon: Download,
    url: (id) => sourceZipUrl(id),
  },
];

/**
 * Fetch an export and save it. Unlike a bare `<a download>` — which silently
 * writes the server's JSON error body to a `*.json` file ("File wasn't
 * available on site") — this inspects the response and surfaces a real failure
 * as a toast, only saving when the response is genuinely a zip.
 */
async function downloadExport(opt: DownloadOption, appId: string): Promise<void> {
  const res = await fetch(opt.url(appId), { credentials: 'include' });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || !contentType.includes('zip')) {
    let message = `Couldn't build the ${opt.label.toLowerCase()} (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || `${opt.kind}.zip`;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

// ── File tree model ──────────────────────────────────────────────
interface TreeFile {
  kind: 'file';
  name: string;
  path: string;
  size: number;
}
interface TreeDir {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}
type TreeNode = TreeFile | TreeDir;

/** Build a nested folder tree from a flat, sorted list of file paths. */
function buildTree(files: SourceFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirIndex = new Map<string, TreeDir>();

  const ensureDir = (segments: string[]): TreeNode[] => {
    let parent = root;
    let prefix = '';
    for (const seg of segments) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      let dir = dirIndex.get(prefix);
      if (!dir) {
        dir = { kind: 'dir', name: seg, path: prefix, children: [] };
        dirIndex.set(prefix, dir);
        parent.push(dir);
      }
      parent = dir.children;
    }
    return parent;
  };

  for (const f of files) {
    const segments = f.path.split('/');
    const name = segments.pop()!;
    const container = ensureDir(segments);
    container.push({ kind: 'file', name, path: f.path, size: f.size });
  }

  // Folders first, then files; each group alphabetical.
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.kind === 'dir') sortNodes(n.children);
  };
  sortNodes(root);
  return root;
}

function fileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'json') return FileJson;
  if (['tsx', 'ts', 'jsx', 'js'].includes(ext)) return FileCode;
  if (['md', 'txt', 'css', 'csv', 'html'].includes(ext)) return FileText;
  return FileIcon;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Tree view ────────────────────────────────────────────────────
function TreeView({
  nodes,
  depth,
  selected,
  collapsed,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  selected: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <ul className="select-none">
      {nodes.map((node) => {
        const pad = { paddingLeft: `${depth * 12 + 8}px` };
        if (node.kind === 'dir') {
          const isOpen = !collapsed.has(node.path);
          const Chevron = isOpen ? ChevronDown : ChevronRight;
          const FolderGlyph = isOpen ? FolderOpen : Folder;
          return (
            <li key={node.path}>
              <button
                type="button"
                onClick={() => onToggle(node.path)}
                className="flex w-full items-center gap-1 py-1 pr-2 text-left text-sm text-foreground hover:bg-accent"
                style={pad}
              >
                <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <FolderGlyph className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{node.name}</span>
              </button>
              {isOpen && (
                <TreeView
                  nodes={node.children}
                  depth={depth + 1}
                  selected={selected}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onSelect={onSelect}
                />
              )}
            </li>
          );
        }
        const Glyph = fileIcon(node.name);
        const isSelected = selected === node.path;
        return (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm hover:bg-accent ${
                isSelected ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'
              }`}
              style={pad}
            >
              <Glyph className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Panel ────────────────────────────────────────────────────────
export default function SourcePanel({ appId }: { appId: string }) {
  const [files, setFiles] = useState<SourceFileEntry[]>([]);
  const [appName, setAppName] = useState('app');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  // Which export is currently being built/downloaded (for the spinner).
  const [downloading, setDownloading] = useState<DownloadKind | null>(null);

  const runDownload = useCallback(
    async (opt: DownloadOption) => {
      if (downloading) return;
      setDownloading(opt.kind);
      const pending = toast.loading(`Building ${opt.label.toLowerCase()}…`);
      try {
        await downloadExport(opt, appId);
        toast.success(`${opt.label} downloaded.`, { id: pending });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `${opt.label} failed.`, { id: pending });
      } finally {
        setDownloading(null);
      }
    },
    [appId, downloading],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listSource(appId);
    if (!res.ok) {
      setError(
        res.status === 404
          ? 'No source is available yet. Build the app first.'
          : res.error || 'Failed to load source.',
      );
      setFiles([]);
      setLoading(false);
      return;
    }
    setFiles(res.files);
    setAppName(res.appName);
    setSelected((prev) => (prev && res.files.some((f) => f.path === prev) ? prev : res.files[0]?.path ?? null));
    setLoading(false);
  }, [appId]);

  useEffect(() => {
    setSelected(null);
    void load();
  }, [load]);

  const tree = useMemo(() => buildTree(files), [files]);
  const selectedSize = useMemo(
    () => files.find((f) => f.path === selected)?.size ?? 0,
    [files, selected],
  );

  // Load the selected file's content, guarding against out-of-order responses.
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (!selected) {
      setContent('');
      setContentError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    setContentLoading(true);
    setContentError(null);
    void getSourceFile(appId, selected).then((res) => {
      if (reqId !== reqIdRef.current) return;
      setContentLoading(false);
      if (res.ok) {
        setContent(res.content);
      } else {
        setContent('');
        setContentError(res.error || 'Failed to load file.');
      }
    });
  }, [appId, selected]);

  const toggleDir = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h2 className="truncate text-sm font-semibold text-foreground">Source code</h2>
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Read-only
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A read-only mirror of your app's generated source. Not a standalone runnable project — it
            depends on the Exepad SDK &amp; runtime.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`${btn.primary} ${files.length === 0 ? 'pointer-events-none opacity-50' : ''}`}
                disabled={files.length === 0 || downloading !== null}
                title="Export this app — deployable bundle, buildable source, handover kit, or a read-only mirror"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {DOWNLOAD_OPTIONS.map((opt) => {
                const Glyph = opt.Icon;
                return (
                  <DropdownMenuItem
                    key={opt.kind}
                    disabled={downloading !== null}
                    onSelect={(e) => {
                      e.preventDefault();
                      void runDownload(opt);
                    }}
                    className="flex items-start gap-2.5 py-2"
                  >
                    {downloading === opt.kind ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <Glyph className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                      <span className="block text-xs text-muted-foreground">{opt.desc}</span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="p-4">
          <Spinner label="Loading source…" />
        </div>
      ) : error ? (
        <div className="p-4">
          <ErrorBanner message={error} />
        </div>
      ) : files.length === 0 ? (
        <EmptyState>
          <p>No source files found for this app.</p>
        </EmptyState>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* File tree */}
          <div className="w-52 shrink-0 overflow-auto border-r border-border py-1 sm:w-64">
            <TreeView
              nodes={tree}
              depth={0}
              selected={selected}
              collapsed={collapsed}
              onToggle={toggleDir}
              onSelect={setSelected}
            />
          </div>

          {/* Viewer */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {selected ? (
              <>
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={selected}>
                    {selected}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatSize(selectedSize)}
                  </span>
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background">
                  {contentLoading ? (
                    <div className="p-4">
                      <Spinner />
                    </div>
                  ) : contentError ? (
                    <div className="p-4">
                      <ErrorBanner message={contentError} />
                    </div>
                  ) : (
                    <CodeView code={content} filename={selected} />
                  )}
                </div>
              </>
            ) : (
              <EmptyState>
                <p>Select a file to view its source.</p>
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
