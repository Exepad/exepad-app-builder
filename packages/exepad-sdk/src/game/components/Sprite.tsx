/**
 * Sprite — render an inline SVG string at a positioned + rotated location.
 *
 * Replaces the usual ``new Image() + onload + drawImage`` race-condition
 * dance for canvas sprite rendering. Renders the SVG directly into the DOM
 * via ``dangerouslySetInnerHTML`` and absolute-positions it; transform
 * picks up rotation and optional scale.
 *
 * The SVG string MUST be trusted source — typically a hand-authored sprite
 * baked into the game component. Don't pass user-supplied SVG; we use
 * ``dangerouslySetInnerHTML`` which doesn't sanitise.
 *
 * @example
 *   const MARIO_SVG = `<svg viewBox="0 0 32 32">...</svg>`;
 *   <div className="relative w-full h-screen">
 *     <Sprite svg={MARIO_SVG} x={player.x} y={player.y} />
 *   </div>
 */

export interface SpriteProps {
  /** Trusted SVG markup — rendered verbatim into a positioned wrapper. */
  svg: string;
  /** Top-left X in pixels relative to the nearest positioned ancestor. */
  x: number;
  /** Top-left Y in pixels relative to the nearest positioned ancestor. */
  y: number;
  /** Render width in CSS pixels. Defaults to 32 (matches typical sprite). */
  width?: number;
  /** Render height in CSS pixels. Defaults to 32. */
  height?: number;
  /** Rotation in degrees (positive = clockwise). Default 0. */
  rotation?: number;
  /** Uniform scale multiplier. Default 1. */
  scale?: number;
  /** Mirror horizontally (e.g. flip Mario when running left). Default false. */
  flipX?: boolean;
  /** Optional className for additional styling on the wrapper. */
  className?: string;
}

export function Sprite({
  svg,
  x,
  y,
  width = 32,
  height = 32,
  rotation = 0,
  scale = 1,
  flipX = false,
  className,
}: SpriteProps) {
  const transforms = [
    `translate(${x}px, ${y}px)`,
    rotation !== 0 ? `rotate(${rotation}deg)` : null,
    scale !== 1 ? `scale(${scale})` : null,
    flipX ? 'scaleX(-1)' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        transform: transforms,
        transformOrigin: 'center',
        pointerEvents: 'none',
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
