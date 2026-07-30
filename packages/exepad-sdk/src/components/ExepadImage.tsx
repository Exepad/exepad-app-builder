/**
 * ExepadImage — Structured image component for Code Focus apps.
 *
 * Collects image metadata (keywords, size, importance) as typed props so the
 * build-time resolver can fetch properly licensed stock images deterministically.
 * At runtime, renders the resolved <img> or a skeleton placeholder.
 *
 * Dynamic design-import path: when ``src`` is empty but
 * ``data-asset-relpath`` is set (e.g. from a .map() over
 * ``useModel('products').data`` where each row carries
 * ``image: "assets/imports/xxx.webp"``), we resolve the relpath against
 * the app's basePath at render time. This mirrors the build-time
 * ``__ASSET_IMG:`` placeholder rewrite for static ``data-asset-relpath``.
 *
 * Error handling: a resolved URL that fails to load (e.g. a hotlinked URL
 * the agent kept because no stock-image provider was configured, which
 * later 404s) falls back to the same skeleton placeholder shown when no
 * src is present — never a broken-image glyph.
 */

import { useEffect, useState } from 'react';

export interface ExepadImageProps {
  /** Stock photo search keywords (5+ words, English). Used by resolver as search query. */
  keywords: string;
  /** Desired display width in pixels. Informs stock photo resolution. */
  width?: number;
  /** Desired display height in pixels. Informs stock photo resolution. */
  height?: number;
  /** Image importance 1-10. Informs loading priority (eager/lazy) and ordering.
   *  Provider selection no longer keys off this — the resolver tries each
   *  configured free provider (Pexels / Pixabay / Unsplash) in turn. */
  importance?: number;
  /** Object-fit mode applied to the rendered <img>. Default: "cover" */
  fit?: 'cover' | 'contain' | 'fill' | 'none';
  /** Resolved image URL. Injected by the build-time resolver — not set by the LLM. */
  src?: string;
  /** Image provider name (e.g. "pexels", "pixabay", "openverse", "catalog").
   *  Injected by the resolver. */
  vendor?: string;
  /** Provider-specific asset/resource ID. Injected by the resolver. */
  assetId?: string;
  /** Tailwind classes for the <img> / placeholder element. */
  className?: string;
  /**
   * Repo-asset relative path (e.g. ``"assets/imports/abc.webp"`` or
   * ``"imports/abc.webp"``). Set by the build-time resolver for static
   * design-import images; may also be set by a ``useModel`` map where
   * the model column holds the relpath. Resolved to a served URL at
   * render time against ``window.__EXEPAD_BASE_PATH__``.
   */
  'data-asset-relpath'?: string;
}

const DEFAULT_IMPORTANCE = 5;

function getFallbackBasePath(): string {
  if (typeof window !== 'undefined') {
    return (window as unknown as { __EXEPAD_BASE_PATH__?: string }).__EXEPAD_BASE_PATH__ || '';
  }
  return '';
}

/**
 * Resolve a design-import repo-asset relpath to a served URL.
 *
 * Accepts both ``"assets/imports/x.webp"`` and ``"imports/x.webp"`` shapes,
 * and passes through already-absolute URLs unchanged.
 */
function resolveAssetRelpath(relpath: string): string {
  if (!relpath) return '';
  // Absolute URL or already-served app path — leave alone.
  if (/^(https?:)?\/\//.test(relpath) || relpath.startsWith('/a/') || relpath.startsWith('__ASSET_IMG:')) {
    return relpath;
  }
  const base = getFallbackBasePath(); // e.g. "/a/ynkeso1w"
  if (!base) {
    // Defensive — no basePath known (e.g. SSR context). Return a
    // scoped repo path the runtime can still serve under its SPA base.
    return `/repo/${relpath.startsWith('assets/') ? relpath : `assets/${relpath}`}`;
  }
  const assetSuffix = relpath.startsWith('assets/') ? relpath : `assets/${relpath}`;
  return `${base}/repo/${assetSuffix}`;
}

export function ExepadImage(props: ExepadImageProps) {
  const {
    keywords,
    width,
    height,
    importance = DEFAULT_IMPORTANCE,
    fit = 'cover',
    src,
    vendor,
    assetId,
    className,
  } = props;
  const assetRelpath = props['data-asset-relpath'];
  const [failed, setFailed] = useState(false);

  // Resolve order: explicit src > data-asset-relpath (runtime resolve) > skeleton.
  const resolvedSrc = src || (assetRelpath ? resolveAssetRelpath(assetRelpath) : '');

  // Reset the failure state when the source changes so a reused React slot
  // (e.g. a filtered/sorted useModel list at a stable position) re-attempts
  // the new URL instead of staying stuck on the skeleton.
  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (resolvedSrc && !failed) {
    return (
      <img
        src={resolvedSrc}
        alt={keywords}
        loading={importance >= 5 ? 'eager' : 'lazy'}
        style={{ objectFit: fit }}
        className={className}
        onError={() => setFailed(true)}
        data-exepad-image={keywords}
        data-importance={importance}
        data-vendor={vendor}
        data-asset-id={assetId}
        data-asset-relpath={assetRelpath}
      />
    );
  }

  // No resolved src — render a skeleton placeholder with aspect ratio hint
  const aspect =
    width && height ? { aspectRatio: `${width} / ${height}` } : undefined;

  return (
    <div
      className={`animate-pulse rounded-md bg-primary/10 ${className ?? ''}`}
      style={{ ...aspect, objectFit: fit }}
      data-exepad-image={keywords}
      data-importance={importance}
      data-vendor={vendor}
      data-asset-id={assetId}
    />
  );
}

// Export the resolver so callers that already hold the relpath (e.g. a
// product row from useModel) can compute the served URL manually.
export { resolveAssetRelpath };
