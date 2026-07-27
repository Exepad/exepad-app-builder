/**
 * Axis-aligned bounding box (AABB) collision helper.
 *
 * The standard 2D rectangle-vs-rectangle overlap check used by every
 * canvas arcade game. Boxes are described by their top-left corner
 * ``(x, y)`` and their ``width`` / ``height`` — the same shape Canvas
 * 2D's ``fillRect`` and ``drawImage`` consume.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Returns ``true`` when boxes ``a`` and ``b`` overlap. Uses strict
 * inequalities, so boxes whose edges are exactly flush (touching but not
 * overlapping) do NOT collide — the standard arcade contract. Symmetric:
 * ``aabb(a, b) === aabb(b, a)``.
 *
 * @example
 *   const player: Box = { x: px, y: py, width: 32, height: 32 };
 *   const goomba: Box = { x: gx, y: gy, width: 28, height: 28 };
 *   if (aabb(player, goomba)) { ... game-over logic ... }
 */
export function aabb(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
}
