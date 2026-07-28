/**
 * Seeded pseudo-random number generator (Mulberry32).
 *
 * Returns a function that produces deterministic floats in ``[0, 1)`` from
 * the same integer seed. Useful for procedural game content where you want
 * the same level layout / enemy positions every time the user replays.
 *
 * Deterministic in-process and across browsers — Mulberry32 is a 32-bit
 * state PRNG with good statistical properties for game-grade randomness
 * (don't use it for cryptography).
 *
 * @example
 *   const rng = seededRandom(42);
 *   const enemyX = Math.floor(rng() * 800);
 *   const enemyY = Math.floor(rng() * 600);
 */
export function seededRandom(seed: number): () => number {
  // Mulberry32 — public domain, ~32 bits of state, faster than xoshiro for JS.
  let state = (seed >>> 0) || 1;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
