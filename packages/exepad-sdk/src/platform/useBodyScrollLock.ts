import * as React from 'react';

/**
 * Lock the page body's scroll while a component is open (mobile menus,
 * modals, drawers, etc.).
 *
 * The motivating bug: components were reaching into `document.body.style.overflow`
 * directly to disable scroll on overlay open. That works, but it's also
 * easy to leak — forgetting to restore the value on unmount or on parent
 * close trapped users with a body that wouldn't scroll until refresh.
 *
 * This hook owns the toggle. It tracks a module-level reference count so
 * nested locks (a Modal inside a Drawer) don't restore prematurely when
 * the inner component unlocks first. On the LAST unlock, the original
 * `body.style.overflow` and `body.style.paddingRight` (used to
 * compensate for the disappearing scrollbar) are restored byte-for-byte.
 *
 * Pass `active=false` to opt out without unmounting (e.g. a controlled
 * Drawer that's closed but mounted).
 *
 * @example
 * function MobileMenu({ open }: { open: boolean }) {
 *   useBodyScrollLock(open);
 *   return open ? <Overlay /> : null;
 * }
 */
export function useBodyScrollLock(active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined') return; // SSR safety
    _lock();
    return () => {
      _unlock();
    };
  }, [active]);
}

// ── module-private reference-counted lock ──────────────────────────────

let _locks = 0;
let _savedOverflow: string | null = null;
let _savedPaddingRight: string | null = null;

function _lock(): void {
  if (_locks === 0) {
    const body = document.body;
    _savedOverflow = body.style.overflow;
    _savedPaddingRight = body.style.paddingRight;
    // Compensate for the vertical scrollbar disappearing so layout
    // doesn't shift when the lock engages on desktop.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
    body.style.overflow = 'hidden';
  }
  _locks += 1;
}

function _unlock(): void {
  _locks = Math.max(0, _locks - 1);
  if (_locks === 0) {
    const body = document.body;
    body.style.overflow = _savedOverflow ?? '';
    body.style.paddingRight = _savedPaddingRight ?? '';
    _savedOverflow = null;
    _savedPaddingRight = null;
  }
}
