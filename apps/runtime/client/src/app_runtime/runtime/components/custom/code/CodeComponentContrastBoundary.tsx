import * as React from 'react';
import {
  blendOverlayOnBase,
  parseColorToRgb,
  resolveColorFromClass,
  rgbToHex,
  extractColorFromTailwindClass,
} from '@/lib/color-resolution';
import {
  cssRgbToHex,
  getContrastRatio,
  getContrastingTextColor,
} from '@/lib/colors';

const MIN_CONTRAST_RATIO = 4.5;
// Code Focus apps from design imports often nest 18-20 levels between a
// foreground element and the runtime root <div class="bg-background">. The
// previous cap of 12 hit the white fallback below before reaching the real
// solid backdrop, mis-correcting text to black on dark themes (Onix CTA bug).
const MAX_BACKGROUND_DEPTH = 32;
let hoverIdCounter = 0;

function isElementVisible(element: HTMLElement): boolean {
  const styles = getComputedStyle(element);
  return (
    styles.display !== 'none' &&
    styles.visibility !== 'hidden' &&
    styles.opacity !== '0'
  );
}

function shouldSkipElement(element: HTMLElement): boolean {
  if (element.getAttribute('aria-hidden') === 'true') return true;
  const className = element.className?.toString() ?? '';
  if (className.includes('text-transparent') || className.includes('bg-clip-text')) {
    return true;
  }
  if (!element.textContent?.trim()) return true;
  return !isElementVisible(element);
}

/**
 * True when `element` is an absolutely/fixed-positioned layer that fills its
 * parent — the hero-backdrop shape `<div className="absolute inset-0">`.
 */
function isFillLayer(element: HTMLElement): boolean {
  const cs = getComputedStyle(element);
  if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
  const isZero = (v: string) => v === '0px' || v === '0';
  if (isZero(cs.top) && isZero(cs.left) && isZero(cs.right) && isZero(cs.bottom)) {
    return true;
  }
  if (cs.inset && /^(?:0px?\s*){1,4}$/.test(cs.inset.trim())) return true;
  // object-cover full-bleed image set directly (no positioned wrapper)
  return cs.width === '100%' && cs.height === '100%';
}

/**
 * True when `element` renders on top of an IMAGE background — either a CSS
 * `background-image` on an ancestor, or the common hero pattern of an
 * absolutely-positioned `<img>`/`<ExepadImage>` backdrop filling an ancestor.
 *
 * The contrast corrector only measures solid `background-color`; it cannot read
 * the luminance of an image. Over an image it resolves the solid page
 * background instead, so light hero text (`text-white`) gets mis-flagged as
 * low-contrast and force-corrected to black — invisible on a dark photo.
 * Author colors over images are intentional, so we skip correction here.
 * Regression: app `mr5czdwj` HomeContent hero — white H1 over a darkened
 * sourdough photo was force-corrected to black, blanking the headline.
 */
function isOverImageBackdrop(element: HTMLElement, root: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current && depth < MAX_BACKGROUND_DEPTH) {
    const cs = getComputedStyle(current);

    // CSS background-image on this level → over an image.
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;

    // A sibling-branch fill layer (not the one holding our text) that IS an
    // image or WRAPS one — the hero backdrop. Two shapes occur in the wild:
    //   <div className="absolute inset-0"><ExepadImage/></div>   (wrapped)
    //   <ExepadImage className="absolute inset-0 …"/>            (img itself)
    // querySelector('img') does NOT match the element itself, so the bare-img
    // shape must be checked with `matches` too (mr5czdwj /our-story hero).
    //
    // This image-fill check MUST run before the opaque-background-color
    // early-return below: a hero <section> commonly carries an opaque theme
    // bg (e.g. `bg-surface`) AND hosts an absolute-inset image backdrop as a
    // sibling of the z-10 text. The image paints over that opaque bg and under
    // the text, so the text IS over the image — but if we returned false on
    // the opaque bg first, we'd never inspect the backdrop child and would
    // wrongly force-correct the hero's `text-white` to black (5dnxdcpo
    // MainHeader: section bg-surface #FFFBEB + ExepadImage child → black h1).
    let hostsImageFill = false;
    for (const child of Array.from(current.children) as HTMLElement[]) {
      if (child === element || child.contains(element)) continue;
      const isImageEl = child.matches('img, picture, [data-exepad-image]');
      const wrapsImage =
        child.querySelector('img, picture, svg image, [data-exepad-image]') !== null;
      if ((isImageEl || wrapsImage) && isFillLayer(child)) {
        hostsImageFill = true;
        break;
      }
    }
    if (hostsImageFill) return true;

    // An opaque solid background-color at this level — with NO image fill-layer
    // child here — IS the real background; contrast is measurable, so this is
    // NOT an over-image case. Keeps the corrector working for e.g. outline
    // buttons that carry their own `bg-background` fill while sitting over a
    // hero image (mr5czdwj home "Our Story" CTA: white text on its own cream
    // fill must still be fixed).
    const bgColor = parseColorToRgb(cs.backgroundColor);
    if (bgColor && bgColor.a >= 0.99) return false;

    if (current === root) break;
    current = current.parentElement;
    depth++;
  }
  return false;
}

function getCompositedBackground(element: HTMLElement): string | null {
  const layers: { r: number; g: number; b: number; a: number }[] = [];
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current && depth < MAX_BACKGROUND_DEPTH) {
    const bg = getComputedStyle(current).backgroundColor;
    const parsed = parseColorToRgb(bg);

    if (parsed && parsed.a > 0.01) {
      if (parsed.a >= 0.99) {
        let base = { r: parsed.r, g: parsed.g, b: parsed.b };
        for (let i = layers.length - 1; i >= 0; i--) {
          base = blendOverlayOnBase(layers[i], base);
        }
        return rgbToHex(base.r, base.g, base.b);
      }
      layers.push(parsed);
    }

    current = current.parentElement;
    depth++;
  }

  if (layers.length === 0) return null;

  // Last-resort fallback: derive the base from the document body's computed
  // background when no opaque ancestor was found within MAX_BACKGROUND_DEPTH.
  // Hardcoding white here breaks dark-themed apps where the truly opaque
  // backdrop is `bg-background` deep above the scan window — assuming white
  // makes near-white text fail contrast and get force-corrected to black.
  let base = { r: 255, g: 255, b: 255 };
  const bodyBg = parseColorToRgb(getComputedStyle(document.body).backgroundColor);
  if (bodyBg && bodyBg.a >= 0.99) {
    base = { r: bodyBg.r, g: bodyBg.g, b: bodyBg.b };
  }
  for (let i = layers.length - 1; i >= 0; i--) {
    base = blendOverlayOnBase(layers[i], base);
  }
  return rgbToHex(base.r, base.g, base.b);
}

function getForeground(element: HTMLElement): string | null {
  const color = getComputedStyle(element).color;
  const parsed = parseColorToRgb(color);
  if (!parsed || parsed.a < 0.01) return null;

  if (parsed.a < 0.99) {
    const bg = getCompositedBackground(element);
    if (!bg) return null;
    const bgRgb = parseColorToRgb(bg);
    if (!bgRgb) return null;
    const blended = blendOverlayOnBase(parsed, bgRgb);
    return rgbToHex(blended.r, blended.g, blended.b);
  }

  return cssRgbToHex(color) ?? rgbToHex(parsed.r, parsed.g, parsed.b);
}

function resolveHoverBackground(element: HTMLElement): string | null {
  const classes = element.className?.toString().split(/\s+/) ?? [];
  for (const className of classes) {
    if (!className.startsWith('hover:bg-')) continue;
    const bgClass = className.replace(/^hover:/, '');
    const direct = extractColorFromTailwindClass(bgClass, 'bg');
    if (direct) return direct;
    const resolved = resolveColorFromClass(bgClass, 'bg');
    if (resolved) return resolved;
  }
  return null;
}

function ensureHoverStyle(styleId: string, rules: string[]): void {
  const existing = document.getElementById(styleId);
  if (rules.length === 0) {
    existing?.remove();
    return;
  }

  const style = (existing as HTMLStyleElement | null) ?? document.createElement('style');
  style.id = styleId;
  style.textContent = rules.join('\n');
  if (!existing) document.head.appendChild(style);
}

function scanAndCorrect(root: HTMLElement, hoverStyleId: string): void {
  const hoverRules: string[] = [];
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      'h1,h2,h3,h4,h5,h6,p,span,li,a,button,label,td,th,blockquote,figcaption,small,strong,em'
    )
  );

  for (const element of candidates) {
    if (shouldSkipElement(element)) continue;

    const foreground = getForeground(element);
    const background = getCompositedBackground(element);
    if (!foreground || !background) continue;

    const ratio = getContrastRatio(foreground, background);
    if (ratio < MIN_CONTRAST_RATIO) {
      // Skip correction when the element sits over an image backdrop — the
      // measured solid background is not the real (image) background, so any
      // correction is a guess that typically makes hero text worse.
      if (isOverImageBackdrop(element, root)) {
        if (import.meta.env.MODE !== 'production') {
          element.dataset.contrastSkippedImageBackdrop = 'true';
        }
      } else {
        const corrected = getContrastingTextColor(background);
        element.style.color = corrected;
        if (import.meta.env.MODE !== 'production') {
          element.dataset.contrastCorrected = 'true';
          element.dataset.contrastRatio = ratio.toFixed(2);
        }
      }
    }

    const hoverBg = resolveHoverBackground(element);
    if (hoverBg) {
      const correctedHover = getContrastingTextColor(hoverBg);
      const id = element.dataset.contrastHoverId || `exepad-hover-${hoverIdCounter++}`;
      element.dataset.contrastHoverId = id;
      hoverRules.push(
        `[data-contrast-hover-id="${id}"]:hover { color: ${correctedHover} !important; }`
      );
    }
  }

  ensureHoverStyle(hoverStyleId, hoverRules);
}

export function CodeComponentContrastBoundary({ children }: { children: React.ReactNode }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const reactId = React.useId();
  const hoverStyleId = React.useMemo(
    () => `exepad-code-component-contrast-hover-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId]
  );

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      timer = null;
      scanAndCorrect(root, hoverStyleId);
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, 25);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden'],
    });

    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      ensureHoverStyle(hoverStyleId, []);
    };
  }, [hoverStyleId]);

  return (
    <div
      ref={rootRef}
      data-code-component-contrast-boundary=""
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  );
}
