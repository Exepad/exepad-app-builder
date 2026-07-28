/**
 * CLS guard for code-component images.
 *
 * Agent-generated components frequently emit `<img src=".../W/H" class="w-full
 * h-auto …">` with NO `width`/`height` attributes and no reserved aspect-ratio.
 * With `h-auto` the box is 0px tall until the image loads, then snaps to its
 * intrinsic height — a large layout shift (measured CLS ~0.24 from a single
 * hero image on a published page). Browsers reserve the box automatically when
 * `width`/`height` attributes are present (implicit `aspect-ratio: auto W / H`),
 * so this guard restores them by reading the dimensions encoded in the image
 * URL — the common placeholder / image-CDN conventions.
 *
 * It NEVER changes the rendered size: CSS (`w-full h-auto`, `object-cover`, an
 * explicit Tailwind height, an `aspect-[…]` class, …) still wins. The
 * attributes only feed the browser's implicit aspect-ratio, reserving the box
 * before the bytes arrive. Conservative by design — it only touches an `<img>`
 * that has no width/height attribute, no inline width/height/aspect-ratio, and
 * no resolved CSS `aspect-ratio`, and only when the URL encodes a clear size.
 */

// Ordered most- to least-specific. Each must capture width then height.
const DIM_PATTERNS: RegExp[] = [
  // ?w=600&h=700 / ?width=600&height=700 (either order tolerated by the 2nd)
  /[?&](?:w|width)=(\d{2,5})\b.*?[?&](?:h|height)=(\d{2,5})\b/i,
  /[?&](?:h|height)=(\d{2,5})\b.*?[?&](?:w|width)=(\d{2,5})\b/i,
  // _600x700 / -1200x630 / 600x700 segment
  /[_\-/](\d{2,5})x(\d{2,5})(?:[._/?#]|$)/i,
  // trailing /600/700 path segments (picsum / many AI placeholder services)
  /\/(\d{2,5})\/(\d{2,5})(?:[/?#]|$)/,
];

/** Extract `{w,h}` from common dimension-encoding URL conventions, or null. */
export function extractImageDims(src: string): { w: number; h: number } | null {
  if (!src) return null;
  for (let i = 0; i < DIM_PATTERNS.length; i++) {
    const m = DIM_PATTERNS[i].exec(src);
    if (m) {
      // The height-first pattern (index 1) swaps the capture order.
      const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
      const w = i === 1 ? b : a;
      const h = i === 1 ? a : b;
      if (w > 0 && h > 0 && w <= 10000 && h <= 10000) return { w, h };
    }
  }
  return null;
}

function reserveImg(img: HTMLImageElement): void {
  if (img.hasAttribute('width') || img.hasAttribute('height')) return;
  const inline = img.style;
  if (inline.width || inline.height || inline.aspectRatio) return;
  // If the author already pinned an aspect-ratio via CSS (e.g. `aspect-video`),
  // the box is already reserved — leave it alone.
  try {
    if (getComputedStyle(img).aspectRatio !== 'auto') return;
  } catch {
    /* getComputedStyle can throw on detached nodes — fall through and try */
  }
  const dims = extractImageDims(img.currentSrc || img.getAttribute('src') || '');
  if (!dims) return;
  // Attributes (not inline size) → the browser derives `aspect-ratio: auto W/H`
  // and reserves the box height, while CSS keeps controlling the rendered size.
  img.setAttribute('width', String(dims.w));
  img.setAttribute('height', String(dims.h));
}

/**
 * Install a guard that reserves dimensions for current and future unsized
 * `<img>` elements under `scope`. Returns a disposer. Runs the initial pass
 * synchronously so images already in the DOM are reserved before the next
 * layout; the MutationObserver fires as a microtask (before paint) for images
 * React inserts later, so the box is reserved before the bytes load.
 */
export function installImageDimensionGuard(scope: HTMLElement): () => void {
  if (!scope || typeof MutationObserver === 'undefined') return () => {};

  const processAdded = (node: Node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName === 'IMG') reserveImg(el as HTMLImageElement);
    else el.querySelectorAll?.('img').forEach((im) => reserveImg(im as HTMLImageElement));
  };

  scope.querySelectorAll('img').forEach((im) => reserveImg(im as HTMLImageElement));

  const obs = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(processAdded);
  });
  obs.observe(scope, { childList: true, subtree: true });
  return () => obs.disconnect();
}
