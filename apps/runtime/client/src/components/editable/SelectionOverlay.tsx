/**
 * Selection Overlay (edit-mode only)
 *
 * Draws the blue selection highlight around whatever element the user clicked
 * in edit mode (a sub-element like a <table>/<button>, or a whole component).
 *
 * Why this exists instead of a ring on the component wrapper:
 *  - In code-focus apps an entire page is a single CodeComponentProps, so a
 *    ComponentWrapper `ring-*` highlights the whole page, not the clicked table.
 *  - Tailwind's `ring` is a `box-shadow`, which is clipped by the
 *    `overflow:hidden` + `perspective`/`will-change:transform` wrapper that
 *    HybridPageTransition puts around page content — so the ring is invisible.
 *
 * This overlay sidesteps both problems: it is a `position:fixed` box
 * portaled to `document.body`, so it escapes the transform containing-block and
 * the overflow clip, and it tracks the exact element reported by the click
 * handlers (see selectionElementStore + EditModeContext.selectComponent).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '@/stores/appStore';
import { getSelectedElement, subscribeSelectedElement } from './selectionElementStore';

interface OverlayRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Gap between the element edge and the highlight border (mirrors ring-offset-2).
const OFFSET = 3;

function rectsEqual(a: OverlayRect | null, b: OverlayRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export function SelectionOverlay() {
  const isEditMode = useAppStore((s) => s.isEditMode);
  const element = useSyncExternalStore(subscribeSelectedElement, getSelectedElement, () => null);
  const [rect, setRect] = useState<OverlayRect | null>(null);

  useEffect(() => {
    if (!isEditMode || !element || typeof window === 'undefined') {
      setRect(null);
      return;
    }

    let raf = 0;
    let last: OverlayRect | null = null;

    // Continuous rAF tracking: a single getBoundingClientRect per frame is cheap,
    // and it follows the element through scrolling, resizes, and any layout shift
    // (e.g. a filter dropdown pushing content) without wiring up many listeners.
    // React only re-renders when the measured rect actually changes.
    const tick = () => {
      if (!element.isConnected) {
        // Element was re-rendered/removed (e.g. after an agent edit) — drop the box.
        if (last !== null) {
          last = null;
          setRect(null);
        }
      } else {
        const r = element.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          if (last !== null) {
            last = null;
            setRect(null);
          }
        } else {
          const next: OverlayRect = { top: r.top, left: r.left, width: r.width, height: r.height };
          if (!rectsEqual(last, next)) {
            last = next;
            setRect(next);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isEditMode, element]);

  if (!isEditMode || !rect || typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-hidden="true"
      data-exepad-selection-overlay=""
      style={{
        position: 'fixed',
        top: rect.top - OFFSET,
        left: rect.left - OFFSET,
        width: rect.width + OFFSET * 2,
        height: rect.height + OFFSET * 2,
        boxSizing: 'border-box',
        border: '2px solid #3b82f6',
        borderRadius: 6,
        // Thin white separator (ring-offset feel) + soft blue glow for contrast
        // on both light and busy backgrounds.
        boxShadow: '0 0 0 1px rgba(255,255,255,0.7), 0 2px 10px rgba(59,130,246,0.25)',
        pointerEvents: 'none',
        zIndex: 2147483000,
        // No transition on position/size: the rAF loop re-measures every frame,
        // so a transition would make the box trail the content during scroll.
      }}
    />,
    document.body,
  );
}

export default SelectionOverlay;
