/**
 * Keyboard-state hook for game controls.
 *
 * Returns a ref to a stable object whose boolean fields reflect whether
 * each control is currently pressed. Both arrow keys and WASD map to the
 * same logical action so the LLM doesn't have to wire both.
 *
 * Reading via ``ref.current`` (not state) means the game loop sees the
 * latest input every frame without triggering re-renders.
 *
 * @example
 *   const keys = useKeys();
 *   useGameLoop((dt) => {
 *     if (keys.current.left)  player.x -= speed * dt;
 *     if (keys.current.right) player.x += speed * dt;
 *     if (keys.current.jump && onGround) player.vy = JUMP_V;
 *   });
 */
import { React } from '../core';

export interface KeysState {
  /** ←  / A */
  left: boolean;
  /** → / D */
  right: boolean;
  /** ↑ / W */
  up: boolean;
  /** ↓ / S */
  down: boolean;
  /** Space / ↑ / W — preferred for arcade jumps. Mirrors ``up``. */
  jump: boolean;
  /** Enter — secondary action / fire / interact. */
  action: boolean;
}

const _NEUTRAL: KeysState = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  action: false,
};

/**
 * True when the key event originated in an editable element (text input,
 * textarea, select, or contentEditable). We must not ``preventDefault`` /
 * swallow keys there — e.g. typing a name into a game-over high-score
 * field, where Space and arrows are legitimate text navigation.
 */
function _isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Map a ``KeyboardEvent.code`` to one of the logical control fields. */
function _logical(code: string): keyof KeysState | null {
  switch (code) {
    case 'ArrowLeft':
    case 'KeyA':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'Space':
      return 'jump';
    case 'Enter':
      return 'action';
    default:
      return null;
  }
}

export function useKeys(): React.MutableRefObject<KeysState> {
  // Single mutable object so the game loop reads stable identity AND
  // current values via ``ref.current.left``.
  const keysRef = React.useRef<KeysState>({ ..._NEUTRAL });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const onDown = (e: KeyboardEvent) => {
      const k = _logical(e.code);
      if (!k) return;
      // Suppress the browser default for game controls — Arrow keys and
      // Space scroll the page, which fights a platformer's jump/move. The
      // listener is non-passive so preventDefault is honored. Skip it when
      // the user is typing in a form field / editable element (e.g. an
      // enter-your-name input on the game-over screen), so we never
      // swallow real text input.
      if (!_isEditableTarget(e.target)) e.preventDefault();
      keysRef.current[k] = true;
      // Up/W also fire jump so canvas games can read either field.
      if (k === 'up') keysRef.current.jump = true;
    };

    const onUp = (e: KeyboardEvent) => {
      const k = _logical(e.code);
      if (!k) return;
      keysRef.current[k] = false;
      if (k === 'up') keysRef.current.jump = false;
    };

    // Reset on blur — prevents stuck-key ghosting when the user
    // alt-tabs while holding a direction.
    const onBlur = () => {
      Object.assign(keysRef.current, _NEUTRAL);
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return keysRef;
}
