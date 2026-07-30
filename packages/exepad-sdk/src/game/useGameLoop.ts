/**
 * Frame-rate-independent game loop hook.
 *
 * Runs ``callback(dt)`` once per animation frame — ``dt`` is the elapsed
 * seconds since the previous frame, capped at 33 ms (~30 FPS) to prevent
 * physics tunnelling when the tab is backgrounded and re-focused. Cleans
 * up the ``requestAnimationFrame`` handle on unmount automatically.
 *
 * Replaces the ~12 LOC of RAF + cleanup boilerplate that every arcade
 * component re-implements (and occasionally gets wrong by forgetting to
 * cancel on unmount, leaking a ghost loop).
 *
 * @example
 *   const [score, setScore] = useState(0);
 *   useGameLoop((dt) => {
 *     // dt is ~0.016 at 60Hz, capped at 0.033 on slow frames.
 *     player.x += player.vx * dt;
 *   });
 *
 * Pause the loop by gating with a ``running`` flag in your callback —
 * the hook itself doesn't expose a pause control because doing so via
 * dependencies would add a re-mount + listener-rewire cost that arcade
 * games can't afford on every state change.
 */
import { React } from '../core';

export type GameLoopCallback = (deltaSeconds: number) => void;

const MAX_DT_SECONDS = 0.033;

export function useGameLoop(callback: GameLoopCallback): void {
  // Latch the latest callback in a ref so we don't restart the RAF loop
  // on every parent re-render — common pattern for "always-fresh" callback
  // hooks (matches React docs' useEffectEvent-shaped guidance).
  const callbackRef = React.useRef(callback);
  React.useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  React.useEffect(() => {
    let rafId = 0;
    let lastTime = 0;

    const tick = (timeMs: number) => {
      if (lastTime === 0) {
        lastTime = timeMs;
        rafId = requestAnimationFrame(tick);
        return;
      }
      const rawDt = (timeMs - lastTime) / 1000;
      lastTime = timeMs;
      const dt = rawDt > MAX_DT_SECONDS ? MAX_DT_SECONDS : rawDt;
      try {
        callbackRef.current(dt);
      } catch (err) {
        // Don't kill the loop on a per-frame exception — log once and
        // keep going so the page doesn't freeze with a half-rendered scene.
        // eslint-disable-next-line no-console
        console.error('[useGameLoop] callback threw:', err);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
