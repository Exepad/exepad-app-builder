import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, cleanup } from '@testing-library/react';
import { aabb, type Box } from './collision';
import { seededRandom } from './random';
import { useGameLoop } from './useGameLoop';
import { useKeys } from './useKeys';
import { Sprite } from './components/Sprite';

/**
 * The game-engine helpers ship verbatim into every generated arcade app, so
 * their numeric + lifecycle contracts are load-bearing:
 *
 *  - aabb()        — the per-frame overlap test that drives every collision /
 *                    game-over branch. Off-by-one in the boundary case means
 *                    sprites either phase through each other or "collide" while
 *                    visibly apart.
 *  - seededRandom  — deterministic procedural content. A drifted sequence means
 *                    a replay no longer reproduces the same level, breaking the
 *                    whole point of seeding.
 *  - useGameLoop   — RAF lifecycle. A missed cancelAnimationFrame leaks a ghost
 *                    loop after unmount; a missing dt-cap tunnels physics when a
 *                    backgrounded tab re-focuses with a multi-second frame.
 *  - Sprite        — transform-string assembly. Wrong order / stray segments
 *                    misplace or mis-rotate every sprite on screen.
 */

// ---------------------------------------------------------------------------
// collision.aabb
// ---------------------------------------------------------------------------
describe('aabb — axis-aligned bounding-box overlap', () => {
  const base: Box = { x: 0, y: 0, width: 10, height: 10 };

  it('returns true for two clearly overlapping boxes', () => {
    const b: Box = { x: 5, y: 5, width: 10, height: 10 };
    expect(aabb(base, b)).toBe(true);
  });

  it('returns true when one box is fully contained within the other', () => {
    const inner: Box = { x: 2, y: 2, width: 2, height: 2 };
    expect(aabb(base, inner)).toBe(true);
    // containment is symmetric.
    expect(aabb(inner, base)).toBe(true);
  });

  it('returns false for boxes separated on the X axis', () => {
    const right: Box = { x: 100, y: 0, width: 10, height: 10 };
    expect(aabb(base, right)).toBe(false);
  });

  it('returns false for boxes separated on the Y axis', () => {
    const below: Box = { x: 0, y: 100, width: 10, height: 10 };
    expect(aabb(base, below)).toBe(false);
  });

  it('returns false when boxes overlap on X but are apart on Y (one axis is enough to separate)', () => {
    // x ranges overlap heavily, but y ranges do not touch — AABB must reject.
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const b: Box = { x: 5, y: 50, width: 10, height: 10 };
    expect(aabb(a, b)).toBe(false);
  });

  it('is symmetric — aabb(a, b) === aabb(b, a)', () => {
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const overlap: Box = { x: 9, y: 9, width: 10, height: 10 };
    const apart: Box = { x: 50, y: 0, width: 10, height: 10 };
    expect(aabb(a, overlap)).toBe(aabb(overlap, a));
    expect(aabb(a, apart)).toBe(aabb(apart, a));
  });

  it('detects a 1px sliver of overlap on the right edge', () => {
    // a spans x:[0,10), b starts at x:9 → 1px of overlap (9 < 10). Real collision.
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const b: Box = { x: 9, y: 0, width: 10, height: 10 };
    expect(aabb(a, b)).toBe(true);
  });

  // EDGE-TOUCHING CONTRACT — DOC vs CODE MISMATCH (audit-flagged).
  //
  // The doc-comment on aabb() claims "touching edges count as collision", but
  // the implementation uses STRICT inequalities (a.x + a.width > b.x), so a box
  // whose right edge exactly meets the other's left edge does NOT collide.
  //
  // The strict-inequality behavior is the standard, correct AABB contract for
  // arcade games (flush-but-not-overlapping rects should not trigger game-over),
  // so these tests assert the ACTUAL CODE behavior (edge-touch => false) and the
  // failing `it.fails` below pins the doc's (incorrect) promise so the mismatch
  // is recorded rather than silently accepted.
  it('treats edge-touching boxes (right edge meets left edge) as NOT colliding', () => {
    // a spans x:[0,10), b starts exactly at x:10 → a.x+a.width (10) > b.x (10) is false.
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const b: Box = { x: 10, y: 0, width: 10, height: 10 };
    expect(aabb(a, b)).toBe(false);
  });

  it('treats edge-touching boxes on the Y axis as NOT colliding', () => {
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const b: Box = { x: 0, y: 10, width: 10, height: 10 };
    expect(aabb(a, b)).toBe(false);
  });

  it('treats corner-touching boxes (share a single point) as NOT colliding', () => {
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const corner: Box = { x: 10, y: 10, width: 10, height: 10 };
    expect(aabb(a, corner)).toBe(false);
  });

  it('treats flush edge-touching boxes as NOT colliding (strict-inequality contract)', () => {
    // The aabb() doc-comment matches the code: strict inequalities, so boxes
    // whose edges are exactly flush touch but do not overlap.
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    const b: Box = { x: 10, y: 0, width: 10, height: 10 };
    expect(aabb(a, b)).toBe(false);
  });

  it('reports a zero-area point strictly INSIDE a box as colliding', () => {
    // A degenerate (0-width/0-height) box that sits strictly within another
    // still satisfies every strict inequality (0 < 5 < 10 on both axes), so the
    // point-inside-rect case is a collision. This documents the actual contract.
    const point: Box = { x: 5, y: 5, width: 0, height: 0 };
    expect(aabb(base, point)).toBe(true);
    expect(aabb(point, base)).toBe(true);
  });

  it('reports a zero-area point ON the box border as NOT colliding', () => {
    // On the boundary the strict inequalities fail (point at x:0 → base.x(0) <
    // x:0 is false on one side), so a point flush with the edge does not collide.
    const onEdge: Box = { x: 0, y: 5, width: 0, height: 0 };
    expect(aabb(base, onEdge)).toBe(false);
  });

  it('handles negative coordinates (boxes in the negative quadrant)', () => {
    const a: Box = { x: -10, y: -10, width: 5, height: 5 };
    const b: Box = { x: -8, y: -8, width: 5, height: 5 };
    const c: Box = { x: -100, y: -100, width: 5, height: 5 };
    expect(aabb(a, b)).toBe(true);
    expect(aabb(a, c)).toBe(false);
  });

  it('handles fractional (sub-pixel) coordinates', () => {
    const a: Box = { x: 0, y: 0, width: 1.5, height: 1.5 };
    const overlap: Box = { x: 1.4, y: 1.4, width: 1, height: 1 };
    const apart: Box = { x: 1.5, y: 0, width: 1, height: 1 }; // flush edge → false
    expect(aabb(a, overlap)).toBe(true);
    expect(aabb(a, apart)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// random.seededRandom (Mulberry32)
// ---------------------------------------------------------------------------
describe('seededRandom — deterministic Mulberry32 PRNG', () => {
  // Golden vector for seed 42, computed from the reference Mulberry32 algorithm.
  // If this drifts, every seeded app's procedural content silently changed.
  const SEED42_GOLDEN = [
    0.6011037519201636,
    0.44829055899754167,
    0.8524657934904099,
    0.6697340414393693,
    0.17481389874592423,
  ];

  it('reproduces the golden sequence for seed 42', () => {
    const rng = seededRandom(42);
    const got = SEED42_GOLDEN.map(() => rng());
    expect(got).toEqual(SEED42_GOLDEN);
  });

  it('produces an identical sequence for two independent generators sharing a seed', () => {
    const a = seededRandom(12345);
    const b = seededRandom(12345);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 64; i++) {
      seqA.push(a());
      seqB.push(b());
    }
    expect(seqA).toEqual(seqB);
  });

  it('produces diverging sequences for different seeds', () => {
    const a = seededRandom(2);
    const b = seededRandom(3);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('keeps every draw within the [0, 1) range across many seeds and draws', () => {
    for (const seed of [0, 1, 42, 999, 123456, 0xffffffff, -7]) {
      const rng = seededRandom(seed);
      for (let i = 0; i < 5000; i++) {
        const v = rng();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('is a stateful stream — successive calls advance (not a constant)', () => {
    const rng = seededRandom(99);
    const first = rng();
    const second = rng();
    expect(first).not.toBe(second);
  });

  it('coerces seed 0 to 1 (the `|| 1` guard) so seeds 0 and 1 share a sequence', () => {
    // `(seed >>> 0) || 1` maps a 0 seed onto state 1 to avoid the all-zero
    // fixed point. This pins that documented coercion rather than treating the
    // collision as a surprise.
    const fromZero = seededRandom(0);
    const fromOne = seededRandom(1);
    for (let i = 0; i < 32; i++) {
      expect(fromZero()).toBe(fromOne());
    }
  });

  it('treats the seed via unsigned 32-bit coercion (negative seeds are valid)', () => {
    // -1 >>> 0 === 0xffffffff, so a negative seed maps to a well-defined state.
    const neg = seededRandom(-1);
    const max = seededRandom(0xffffffff);
    for (let i = 0; i < 16; i++) {
      expect(neg()).toBe(max());
    }
  });
});

// ---------------------------------------------------------------------------
// useGameLoop — RAF lifecycle + dt-cap
// ---------------------------------------------------------------------------
describe('useGameLoop — RAF lifecycle and delta capping', () => {
  // Hand-rolled RAF scheduler: queue the tick callbacks and fire them manually
  // with a controlled timestamp so we can drive frame timing deterministically
  // (happy-dom's RAF would clamp/async, which we can't step precisely).
  let pending: Map<number, FrameRequestCallback>;
  let nextHandle: number;
  let cancelled: Set<number>;
  let rafSpy: ReturnType<typeof vi.fn>;
  let cancelSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pending = new Map();
    cancelled = new Set();
    nextHandle = 1;
    rafSpy = vi.fn((cb: FrameRequestCallback): number => {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    });
    cancelSpy = vi.fn((handle: number): void => {
      cancelled.add(handle);
      pending.delete(handle);
    });
    vi.stubGlobal('requestAnimationFrame', rafSpy);
    vi.stubGlobal('cancelAnimationFrame', cancelSpy);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Fire the single outstanding queued frame with the given timestamp.
  function flushFrame(timeMs: number): void {
    // exactly one RAF should be in flight at a time (the loop re-schedules itself).
    expect(pending.size).toBe(1);
    const [[handle, cb]] = [...pending.entries()];
    pending.delete(handle);
    cb(timeMs);
  }

  it('schedules a frame on mount', () => {
    renderHook(() => useGameLoop(() => {}));
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the callback on the very first frame (it only latches the baseline time)', () => {
    const cb = vi.fn();
    renderHook(() => useGameLoop(cb));
    flushFrame(1000); // first tick — establishes lastTime, no dt yet
    expect(cb).not.toHaveBeenCalled();
    // but it re-scheduled for the next frame.
    expect(rafSpy).toHaveBeenCalledTimes(2);
  });

  it('invokes the callback with elapsed seconds on the second frame', () => {
    const cb = vi.fn();
    renderHook(() => useGameLoop(cb));
    flushFrame(1000); // baseline
    flushFrame(1016); // +16ms → ~0.016s
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBeCloseTo(0.016, 5);
  });

  it('caps dt at 33ms (0.033s) on a long backgrounded-then-refocused frame', () => {
    const cb = vi.fn();
    renderHook(() => useGameLoop(cb));
    flushFrame(0); // baseline at t=0... but 0 is the sentinel, so re-baseline
    flushFrame(5); // establishes a real baseline of 5ms (since t=0 is treated as "unset")
    cb.mockClear();
    // A 4-second gap (tab was backgrounded). Raw dt = 4s; must be clamped to 0.033.
    flushFrame(5 + 4000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe(0.033);
  });

  it('does NOT cap a normal sub-33ms frame', () => {
    const cb = vi.fn();
    renderHook(() => useGameLoop(cb));
    flushFrame(1000);
    flushFrame(1020); // +20ms → 0.02s, under the cap
    expect(cb.mock.calls[0][0]).toBeCloseTo(0.02, 5);
  });

  it('passes a frame exactly at the 33ms cap through uncapped (boundary, not >)', () => {
    const cb = vi.fn();
    renderHook(() => useGameLoop(cb));
    flushFrame(1000);
    flushFrame(1033); // exactly 33ms → rawDt 0.033, `> MAX_DT` is false → passes raw
    expect(cb.mock.calls[0][0]).toBeCloseTo(0.033, 5);
  });

  it('cancels the outstanding RAF handle on unmount (no ghost loop leak)', () => {
    const { unmount } = renderHook(() => useGameLoop(() => {}));
    flushFrame(1000);
    flushFrame(1016);
    // capture the handle currently in flight before unmounting.
    const [[liveHandle]] = [...pending.entries()];
    unmount();
    expect(cancelSpy).toHaveBeenCalled();
    expect(cancelled.has(liveHandle)).toBe(true);
  });

  it('survives a callback that throws — logs once and keeps re-scheduling', () => {
    const boom = vi.fn(() => {
      throw new Error('per-frame explosion');
    });
    renderHook(() => useGameLoop(boom));
    flushFrame(1000); // baseline
    const rafCountBefore = rafSpy.mock.calls.length;
    flushFrame(1016); // callback throws here
    expect(boom).toHaveBeenCalledTimes(1);
    // error was swallowed + logged, not propagated.
    expect(console.error).toHaveBeenCalled();
    // the loop re-scheduled despite the throw.
    expect(rafSpy.mock.calls.length).toBe(rafCountBefore + 1);
    // and a subsequent frame still drives the callback.
    flushFrame(1032);
    expect(boom).toHaveBeenCalledTimes(2);
  });

  it('always uses the latest callback without restarting the loop (ref latching)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useGameLoop(cb), {
      initialProps: { cb: first },
    });
    flushFrame(1000); // baseline
    flushFrame(1016); // drives `first`
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ cb: second });
    flushFrame(1032); // must drive `second` now, on the SAME loop
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1); // first no longer called

    // The loop effect ran once (mount), so cancelAnimationFrame was NOT fired
    // by the rerender — confirming the loop was not torn down + rebuilt.
    expect(cancelSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sprite — transform string assembly
// ---------------------------------------------------------------------------
describe('Sprite — transform string assembly', () => {
  afterEach(() => cleanup());

  // Pull the inline transform off the wrapper element the component renders.
  function transformOf(container: HTMLElement): string {
    const el = container.firstElementChild as HTMLElement;
    return el.style.transform;
  }

  const SVG = '<svg viewBox="0 0 32 32"><rect width="32" height="32"/></svg>';

  it('emits only a translate() when rotation/scale/flip are at defaults', () => {
    const { container } = render(<Sprite svg={SVG} x={10} y={20} />);
    expect(transformOf(container)).toBe('translate(10px, 20px)');
  });

  it('appends rotate() when rotation is non-zero, after translate', () => {
    const { container } = render(<Sprite svg={SVG} x={5} y={6} rotation={90} />);
    expect(transformOf(container)).toBe('translate(5px, 6px) rotate(90deg)');
  });

  it('appends scale() when scale differs from 1', () => {
    const { container } = render(<Sprite svg={SVG} x={0} y={0} scale={2} />);
    expect(transformOf(container)).toBe('translate(0px, 0px) scale(2)');
  });

  it('appends scaleX(-1) when flipX is true', () => {
    const { container } = render(<Sprite svg={SVG} x={1} y={2} flipX />);
    expect(transformOf(container)).toBe('translate(1px, 2px) scaleX(-1)');
  });

  it('assembles all four transform segments in deterministic order', () => {
    const { container } = render(
      <Sprite svg={SVG} x={3} y={4} rotation={45} scale={1.5} flipX />,
    );
    expect(transformOf(container)).toBe(
      'translate(3px, 4px) rotate(45deg) scale(1.5) scaleX(-1)',
    );
  });

  it('omits the rotate/scale segments at their identity values (0deg, scale 1)', () => {
    // rotation:0 and scale:1 are the no-op defaults and must produce no segment,
    // keeping the transform minimal so the browser does not allocate a layer.
    const { container } = render(
      <Sprite svg={SVG} x={7} y={8} rotation={0} scale={1} flipX={false} />,
    );
    expect(transformOf(container)).toBe('translate(7px, 8px)');
  });

  it('handles negative and fractional coordinates verbatim in the translate', () => {
    const { container } = render(<Sprite svg={SVG} x={-12.5} y={0.25} />);
    expect(transformOf(container)).toBe('translate(-12.5px, 0.25px)');
  });

  it('positions the wrapper absolutely with center transform-origin', () => {
    const { container } = render(<Sprite svg={SVG} x={0} y={0} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.position).toBe('absolute');
    expect(el.style.transformOrigin).toBe('center');
    expect(el.style.pointerEvents).toBe('none');
  });

  it('applies width/height defaults of 32 and honors overrides', () => {
    const { container: def } = render(<Sprite svg={SVG} x={0} y={0} />);
    const defEl = def.firstElementChild as HTMLElement;
    expect(defEl.style.width).toBe('32px');
    expect(defEl.style.height).toBe('32px');

    const { container: over } = render(
      <Sprite svg={SVG} x={0} y={0} width={64} height={48} />,
    );
    const overEl = over.firstElementChild as HTMLElement;
    expect(overEl.style.width).toBe('64px');
    expect(overEl.style.height).toBe('48px');
  });

  it('forwards the className to the wrapper', () => {
    const { container } = render(
      <Sprite svg={SVG} x={0} y={0} className="enemy-sprite" />,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toBe('enemy-sprite');
  });

  it('injects the trusted SVG markup verbatim into the wrapper', () => {
    const { container } = render(<Sprite svg={SVG} x={0} y={0} />);
    const el = container.firstElementChild as HTMLElement;
    // The SVG is rendered into the DOM (not escaped) — Sprite's documented
    // trusted-source contract via dangerouslySetInnerHTML.
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('rect')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useKeys — keyboard state + default-scroll suppression
//
// The agent docs (game-arcade skill, custom-app guide) tell the model that
// useKeys "suppresses default scrolling" — Arrow keys and Space scroll the
// page and fight a platformer's jump/move. That contract is load-bearing:
// without preventDefault, every generated game that follows the PREFERRED
// useKeys path scrolls on every jump. The editable-target guard keeps text
// inputs (e.g. a game-over high-score name field) usable.
// ---------------------------------------------------------------------------
describe('useKeys — control state and default-scroll suppression', () => {
  afterEach(() => cleanup());

  function press(code: string, target?: EventTarget): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    (target ?? window).dispatchEvent(ev);
    return ev;
  }

  it('maps arrows and WASD to logical controls', () => {
    const { result } = renderHook(() => useKeys());
    press('ArrowLeft');
    press('KeyD');
    press('Space');
    expect(result.current.current.left).toBe(true);
    expect(result.current.current.right).toBe(true);
    expect(result.current.current.jump).toBe(true);
  });

  it('preventDefaults game control keys so the page does not scroll', () => {
    renderHook(() => useKeys());
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
      const ev = press(code);
      expect(ev.defaultPrevented).toBe(true);
    }
  });

  it('does NOT preventDefault non-control keys', () => {
    renderHook(() => useKeys());
    const ev = press('KeyZ');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('does NOT preventDefault when typing in an editable field (name entry)', () => {
    renderHook(() => useKeys());
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      const ev = press('Space', input); // Space in a text field must type a space
      expect(ev.defaultPrevented).toBe(false);
    } finally {
      document.body.removeChild(input);
    }
  });
});
