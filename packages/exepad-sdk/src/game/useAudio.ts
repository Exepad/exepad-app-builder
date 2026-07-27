/**
 * Audio-effect pool hook for game sound.
 *
 * Pre-loads a named map of sound URLs into ``Audio`` elements and exposes
 * a ``play(name)`` method that clones the buffer on each call so rapid
 * repeated triggers (coin pickup, jump) don't cut each other off.
 *
 * Volume is a 0..1 multiplier applied to every play. Pass ``0`` to mute
 * (e.g. when the user toggles sound off).
 *
 * @example
 *   const audio = useAudio({
 *     jump: '/sounds/jump.mp3',
 *     coin: '/sounds/coin.mp3',
 *   }, 0.6);
 *
 *   const onJump = () => audio.play('jump');
 *   const onCoin = () => audio.play('coin');
 */
import { React } from '../core';

export interface AudioControls<K extends string> {
  /** Play the named sound. Safe to call before assets load (no-ops). */
  play: (name: K) => void;
  /** Stop the currently-playing instance of the named sound. */
  stop: (name: K) => void;
}

export function useAudio<K extends string>(
  sources: Record<K, string>,
  volume: number = 1,
): AudioControls<K> {
  // Map from name → master HTMLAudioElement (used as a clone source).
  const poolRef = React.useRef<Map<string, HTMLAudioElement>>(
    new Map(),
  );

  // Volume kept in a ref so changes don't tear the play function identity.
  const volumeRef = React.useRef(volume);
  volumeRef.current = clampVolume(volume);

  // Materialise the pool once on mount. Re-runs only if the URL map's
  // identity changes; passing a stable ``sources`` object is the
  // caller's responsibility (define it in module scope or memoize it).
  React.useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const pool = poolRef.current;
    pool.clear();
    for (const [name, url] of Object.entries(sources) as [K, string][]) {
      try {
        const el = new Audio(url);
        el.preload = 'auto';
        pool.set(name, el);
      } catch {
        // Audio() throwing is rare (only on URL parse) — skip the entry.
      }
    }
  }, [sources]);

  const play = React.useCallback((name: K) => {
    const master = poolRef.current.get(name);
    if (!master) return;
    try {
      // Clone so overlapping triggers don't cut each other off.
      const inst = master.cloneNode(true) as HTMLAudioElement;
      inst.volume = volumeRef.current;
      // ``play()`` returns a Promise that may reject when the page
      // hasn't received user input yet (Chrome autoplay policy). We
      // swallow that — the user will get sound on the next play after
      // their first interaction.
      void inst.play().catch(() => {
        /* autoplay-blocked or transient — non-fatal */
      });
    } catch {
      /* DOM exception — safe to ignore for SFX */
    }
  }, []);

  const stop = React.useCallback((name: K) => {
    const master = poolRef.current.get(name);
    if (!master) return;
    try {
      master.pause();
      master.currentTime = 0;
    } catch {
      /* ignore */
    }
  }, []);

  return { play, stop };
}

function clampVolume(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
