import * as React from 'react';
import { cn } from './helpers/cn';

export type MapMarker = {
  id?: string | number;
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  icon?: React.ReactNode;
  onClick?: (marker: MapMarker) => void;
};

export type MapProps = {
  className?: string;
  center?: { lat: number; lng: number };
  zoom?: number;
  bbox?: { south: number; west: number; north: number; east: number };
  markers?: MapMarker[];
  interactive?: boolean;
  layer?: 'mapnik' | 'transport' | 'cyclemap' | 'hot';
  height?: string | number;
  onMarkerClick?: (marker: MapMarker) => void;
};

const LAYER_MAP: Record<NonNullable<MapProps['layer']>, string> = {
  mapnik: 'mapnik',
  transport: 'transportmap',
  cyclemap: 'cyclemap',
  hot: 'hot',
};

function deriveBbox(
  center: { lat: number; lng: number },
  zoom: number,
): { south: number; west: number; north: number; east: number } {
  const scale = Math.pow(2, 15 - zoom);
  const dLat = 0.02 * scale;
  const dLng = 0.04 * scale;
  return {
    south: center.lat - dLat,
    west: center.lng - dLng,
    north: center.lat + dLat,
    east: center.lng + dLng,
  };
}

function projectMarker(
  marker: MapMarker,
  bbox: { south: number; west: number; north: number; east: number },
): { x: number; y: number } | null {
  const { lat, lng } = marker;
  if (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east) {
    return null;
  }
  const x = ((lng - bbox.west) / (bbox.east - bbox.west)) * 100;
  const y = ((bbox.north - lat) / (bbox.north - bbox.south)) * 100;
  return { x, y };
}

export function Map({
  className,
  center = { lat: 52.52, lng: 13.405 },
  zoom = 12,
  bbox,
  markers = [],
  interactive = true,
  layer = 'mapnik',
  height = 400,
  onMarkerClick,
}: MapProps) {
  const box = bbox ?? deriveBbox(center, zoom);
  const markerParam = `&marker=${center.lat}%2C${center.lng}`;
  const src =
    `https://www.openstreetmap.org/export/embed.html` +
    `?bbox=${box.west}%2C${box.south}%2C${box.east}%2C${box.north}` +
    `&layer=${LAYER_MAP[layer]}` +
    markerParam;

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-lg border border-border bg-muted',
        className,
      )}
      style={{ height }}
    >
      <iframe
        title="Map"
        src={src}
        className="absolute inset-0 h-full w-full"
        style={{
          border: 0,
          pointerEvents: interactive ? 'auto' : 'none',
        }}
        loading="lazy"
      />
      {markers.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {markers.map((m, i) => {
            const proj = projectMarker(m, box);
            if (!proj) return null;
            const key = m.id ?? i;
            const color = m.color ?? 'hsl(var(--primary))';
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  m.onClick?.(m);
                  onMarkerClick?.(m);
                }}
                className={cn(
                  'pointer-events-auto absolute -translate-x-1/2 -translate-y-full',
                  'flex flex-col items-center gap-1',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                style={{ left: `${proj.x}%`, top: `${proj.y}%` }}
                aria-label={m.label}
              >
                {m.icon ?? (
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-md"
                    style={{ backgroundColor: color }}
                  >
                    {i + 1}
                  </span>
                )}
                {m.label && (
                  <span className="rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow">
                    {m.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type MapLinkProps = {
  lat: number;
  lng: number;
  zoom?: number;
  children?: React.ReactNode;
  className?: string;
};

export function MapLink({ lat, lng, zoom = 15, children, className }: MapLinkProps) {
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children ?? 'Open in OpenStreetMap'}
    </a>
  );
}
