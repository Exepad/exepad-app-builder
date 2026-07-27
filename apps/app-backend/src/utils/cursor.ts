/**
 * Cursor utilities for keyset-based pagination.
 *
 * Cursor format: base64({ f: field, v: value, d: direction, tf: tieField, tv: tieValue })
 *
 * Uses a composite cursor (main field + tie-breaker primary key) to guarantee
 * uniqueness and prevent row skipping when the main cursor field has duplicates.
 */

export interface CursorPayload {
  /** Cursor field name */
  f: string;
  /** Last-seen value of that field */
  v: unknown;
  /** Sort direction */
  d: 'asc' | 'desc';
  /** Tie-breaker field name (primary key) */
  tf: string;
  /** Tie-breaker value */
  tv: unknown;
}

/**
 * Encode a cursor from field + last value + direction + tie-breaker.
 */
export function encodeCursor(
  field: string,
  value: unknown,
  direction: 'asc' | 'desc',
  tieField: string,
  tieValue: unknown
): string {
  const payload: CursorPayload = { f: field, v: value, d: direction, tf: tieField, tv: tieValue };
  return btoa(JSON.stringify(payload));
}

/**
 * Decode cursor string back to payload.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = atob(cursor);
    const payload = JSON.parse(json) as CursorPayload;
    if (!payload.f || !payload.d || !payload.tf) return null;
    if (payload.v === undefined || payload.tv === undefined) return null;
    return payload;
  } catch {
    return null;
  }
}
