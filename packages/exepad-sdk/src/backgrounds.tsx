import * as React from 'react';
import { cn } from './helpers/cn';

export type NoiseBgProps = {
  className?: string;
  opacity?: number;
  scale?: number;
};

export function NoiseBg({
  className,
  opacity = 0.08,
  scale = 1,
}: NoiseBgProps) {
  const id = React.useId();
  return (
    <svg
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
    >
      <filter id={`noise-${id}`}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency={0.9 / scale}
          numOctaves="3"
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect
        width="100%"
        height="100%"
        filter={`url(#noise-${id})`}
        opacity={opacity}
      />
    </svg>
  );
}

export type MeshGradientProps = {
  className?: string;
  variant?: 'aurora' | 'sunset' | 'ocean' | 'forest' | 'ember' | 'plum';
  opacity?: number;
};

const MESH_VARIANTS: Record<
  NonNullable<MeshGradientProps['variant']>,
  { a: string; b: string; c: string }
> = {
  aurora: { a: '#a855f7', b: '#0ea5e9', c: '#22d3ee' },
  sunset: { a: '#f97316', b: '#ec4899', c: '#8b5cf6' },
  ocean: { a: '#0ea5e9', b: '#14b8a6', c: '#6366f1' },
  forest: { a: '#16a34a', b: '#65a30d', c: '#0ea5e9' },
  ember: { a: '#dc2626', b: '#f97316', c: '#fbbf24' },
  plum: { a: '#7e22ce', b: '#db2777', c: '#6366f1' },
};

export function MeshGradient({
  className,
  variant = 'aurora',
  opacity = 1,
}: MeshGradientProps) {
  const c = MESH_VARIANTS[variant];
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0', className)}
      style={{
        opacity,
        backgroundImage: [
          `radial-gradient(at 20% 20%, ${c.a}55 0px, transparent 55%)`,
          `radial-gradient(at 80% 10%, ${c.b}55 0px, transparent 50%)`,
          `radial-gradient(at 75% 80%, ${c.c}55 0px, transparent 55%)`,
          `radial-gradient(at 10% 85%, ${c.a}33 0px, transparent 60%)`,
        ].join(', '),
      }}
    />
  );
}

export type GridPatternProps = {
  className?: string;
  size?: number;
  strokeOpacity?: number;
  strokeColor?: string;
  fade?: boolean;
};

export function GridPattern({
  className,
  size = 32,
  strokeOpacity = 0.08,
  strokeColor = 'currentColor',
  fade = true,
}: GridPatternProps) {
  const id = React.useId();
  const maskId = `grid-mask-${id}`;
  const patternId = `grid-pattern-${id}`;
  return (
    <svg
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id={patternId}
          width={size}
          height={size}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${size} 0 L 0 0 0 ${size}`}
            fill="none"
            stroke={strokeColor}
            strokeOpacity={strokeOpacity}
            strokeWidth="1"
          />
        </pattern>
        {fade && (
          <radialGradient id={maskId} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
        )}
        {fade && (
          <mask id={`${maskId}-mask`}>
            <rect width="100%" height="100%" fill={`url(#${maskId})`} />
          </mask>
        )}
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${patternId})`}
        {...(fade ? { mask: `url(#${maskId}-mask)` } : {})}
      />
    </svg>
  );
}

export type DotPatternProps = {
  className?: string;
  size?: number;
  dotSize?: number;
  color?: string;
  opacity?: number;
  fade?: boolean;
};

export function DotPattern({
  className,
  size = 20,
  dotSize = 1.25,
  color = 'currentColor',
  opacity = 0.2,
  fade = true,
}: DotPatternProps) {
  const id = React.useId();
  const patternId = `dots-${id}`;
  const maskId = `dots-mask-${id}`;
  return (
    <svg
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id={patternId}
          width={size}
          height={size}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={dotSize}
            fill={color}
            fillOpacity={opacity}
          />
        </pattern>
        {fade && (
          <radialGradient id={maskId} cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
        )}
        {fade && (
          <mask id={`${maskId}-mask`}>
            <rect width="100%" height="100%" fill={`url(#${maskId})`} />
          </mask>
        )}
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${patternId})`}
        {...(fade ? { mask: `url(#${maskId}-mask)` } : {})}
      />
    </svg>
  );
}
