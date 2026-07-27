/**
 * Joystick — on-screen mobile controls for canvas games.
 *
 * Renders three big touch-friendly buttons (left / jump / right) in a flex
 * row. Each button reports its press state via callback props; the parent
 * stores those in refs and reads them from the game loop, exactly like
 * keyboard input via ``useKeys``.
 *
 * Handles both touch and mouse events because Chromium DevTools' device
 * emulator dispatches mouse events even in touch mode.
 *
 * Replaces the ~80 LOC of touchstart/touchend/mousedown/mouseup/mouseleave
 * handlers each game would otherwise re-implement.
 *
 * @example
 *   const keys = useKeys();
 *   <Joystick
 *     onDirection={(dir, pressed) => { keys.current[dir] = pressed; }}
 *     onJump={(pressed) => { keys.current.jump = pressed; }}
 *   />
 */
import { React } from '../../core';

export type JoystickDirection = 'left' | 'right';

export interface JoystickProps {
  /** Fired when left/right is pressed or released. */
  onDirection: (direction: JoystickDirection, pressed: boolean) => void;
  /** Fired when the jump button is pressed or released. */
  onJump: (pressed: boolean) => void;
  /** Optional className appended to the row wrapper. */
  className?: string;
}

interface ControlButtonProps {
  label: React.ReactNode;
  ariaLabel: string;
  onPress: (pressed: boolean) => void;
  variant: 'direction' | 'jump';
}

function ControlButton({ label, ariaLabel, onPress, variant }: ControlButtonProps) {
  const press = (pressed: boolean) => () => onPress(pressed);
  const baseColor =
    variant === 'jump'
      ? 'bg-secondary text-on-secondary'
      : 'bg-primary text-on-primary';
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onTouchStart={press(true)}
      onTouchEnd={press(false)}
      onTouchCancel={press(false)}
      onMouseDown={press(true)}
      onMouseUp={press(false)}
      onMouseLeave={press(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex-1 py-4 select-none font-headline text-sm rounded-md ${baseColor}`}
      style={{ touchAction: 'manipulation', userSelect: 'none' }}
    >
      {label}
    </button>
  );
}

export function Joystick({ onDirection, onJump, className }: JoystickProps) {
  return (
    <div className={`grid grid-cols-3 gap-2 ${className ?? ''}`.trim()}>
      <ControlButton
        ariaLabel="Move left"
        label="◀"
        variant="direction"
        onPress={(pressed) => onDirection('left', pressed)}
      />
      <ControlButton
        ariaLabel="Jump"
        label="JUMP"
        variant="jump"
        onPress={onJump}
      />
      <ControlButton
        ariaLabel="Move right"
        label="▶"
        variant="direction"
        onPress={(pressed) => onDirection('right', pressed)}
      />
    </div>
  );
}
