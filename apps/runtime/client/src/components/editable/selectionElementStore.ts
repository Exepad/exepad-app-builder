/**
 * Selection Element Store (edit-mode only)
 *
 * Holds a reference to the *actual DOM element* the user clicked so the
 * SelectionOverlay can draw a highlight box around it.
 *
 * Why a standalone external store (not the Zustand appStore):
 *  - The value is a live `HTMLElement`. The appStore runs through `devtools`
 *    (dev) and `persist` middleware; serializing a DOM node there is at best
 *    noisy and at worst throws on circular references.
 *  - Only the SelectionOverlay needs to react to it, so a tiny
 *    subscribe/getSnapshot store consumed via `useSyncExternalStore` keeps the
 *    re-render surface to exactly one component.
 *
 * This is intentionally separate from `selectedComponentId` (the serializable
 * selection identity that drives ComponentWrapper state and the postMessage to
 * the editor) — see EditModeContext.selectComponent, which sets both together.
 */

type Listener = () => void;

let selectedElement: HTMLElement | null = null;
const listeners = new Set<Listener>();

export function setSelectedElement(el: HTMLElement | null): void {
  if (selectedElement === el) return;
  selectedElement = el;
  listeners.forEach((listener) => listener());
}

export function getSelectedElement(): HTMLElement | null {
  return selectedElement;
}

export function subscribeSelectedElement(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
