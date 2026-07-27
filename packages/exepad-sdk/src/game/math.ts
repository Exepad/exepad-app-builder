/**
 * Math helpers for game components.
 *
 * Tiny utilities that get reinvented in every arcade-game component. Keeping
 * them in the SDK lets the LLM call them by name instead of redefining
 * them inline (and reduces the prior probability of the
 * ``ComponentBuilder`` token-cap firing on legitimate game output).
 */

/** Clamp ``value`` to the inclusive range ``[min, max]``. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Linear interpolate from ``a`` to ``b`` by ``t`` (typically 0..1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
