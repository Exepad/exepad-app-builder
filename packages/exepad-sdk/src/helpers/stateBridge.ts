/**
 * Bridge to window.ExepadState — the runtime's state management hooks.
 * Same pattern as bridge.ts → window.ExepadPlatform.
 */

export function getExepadState(): any | null {
  if (typeof window !== 'undefined' && (window as any).ExepadState) {
    return (window as any).ExepadState;
  }
  return null;
}
