/**
 * Tests for relative-date token expansion in seed data.
 *
 * Token grammar (see relative-dates.ts for the full spec):
 *
 *   __TODAY__         → YYYY-MM-DD (UTC)
 *   __TODAY__-7d      → 7 days before deploy time
 *   __TODAY__+30d     → 30 days after
 *   __TODAY__+1mo     → calendar add with end-of-month clamping
 *   __NOW__           → ISO 8601 UTC, ms precision
 *   __NOW__-30m       → 30 minutes before deploy time
 */

import { describe, it, expect } from 'vitest';
import {
  expandRecords,
  expandTokens,
  RelativeDateTokenError,
} from '../src/seed/relative-dates';


// Fixed anchor for deterministic tests: 2026-05-08T12:00:00.000Z (Friday).
const NOW = new Date('2026-05-08T12:00:00.000Z');


describe('expandTokens', () => {
  describe('valid tokens', () => {
    it('expands __TODAY__ to YYYY-MM-DD UTC', () => {
      expect(expandTokens('__TODAY__', NOW)).toBe('2026-05-08');
    });

    it('expands __TODAY__-7d (negative day offset)', () => {
      expect(expandTokens('__TODAY__-7d', NOW)).toBe('2026-05-01');
    });

    it('expands __TODAY__+30d (positive day offset)', () => {
      expect(expandTokens('__TODAY__+30d', NOW)).toBe('2026-06-07');
    });

    it('expands week offsets', () => {
      expect(expandTokens('__TODAY__-2w', NOW)).toBe('2026-04-24');
      expect(expandTokens('__TODAY__+1w', NOW)).toBe('2026-05-15');
    });

    it('expands month offsets with end-of-month clamping', () => {
      const jan31 = new Date('2026-01-31T00:00:00.000Z');
      // Jan 31 + 1mo → Feb 28 (2026 is not a leap year)
      expect(expandTokens('__TODAY__+1mo', jan31)).toBe('2026-02-28');
    });

    it('expands month offsets going backwards across year boundaries', () => {
      const mar15 = new Date('2026-03-15T00:00:00.000Z');
      expect(expandTokens('__TODAY__-3mo', mar15)).toBe('2025-12-15');
    });

    it('expands __NOW__ as ISO 8601 with ms precision', () => {
      expect(expandTokens('__NOW__', NOW)).toBe('2026-05-08T12:00:00.000Z');
    });

    it('expands __NOW__-30m', () => {
      expect(expandTokens('__NOW__-30m', NOW)).toBe('2026-05-08T11:30:00.000Z');
    });

    it('expands __NOW__-2h', () => {
      expect(expandTokens('__NOW__-2h', NOW)).toBe('2026-05-08T10:00:00.000Z');
    });

    it('expands __NOW__+5d as ISO 8601', () => {
      expect(expandTokens('__NOW__+5d', NOW)).toBe('2026-05-13T12:00:00.000Z');
    });
  });

  describe('non-string passthrough', () => {
    it('passes numbers through unchanged', () => {
      expect(expandTokens(42, NOW)).toBe(42);
    });

    it('passes booleans through unchanged', () => {
      expect(expandTokens(true, NOW)).toBe(true);
    });

    it('passes null through unchanged', () => {
      expect(expandTokens(null, NOW)).toBe(null);
    });

    it('passes nested objects through unchanged', () => {
      const obj = { foo: 'bar' };
      expect(expandTokens(obj, NOW)).toBe(obj);
    });
  });

  describe('non-token strings', () => {
    it('passes plain dates through unchanged', () => {
      expect(expandTokens('2025-01-15', NOW)).toBe('2025-01-15');
    });

    it('passes free-text containing __TODAY__ through unchanged', () => {
      // Domain text — `__TODAY__` is buried inside a sentence, not a token.
      expect(expandTokens('Welcome to the __TODAY__ promo', NOW)).toBe(
        'Welcome to the __TODAY__ promo',
      );
    });

    it('passes empty strings through unchanged', () => {
      expect(expandTokens('', NOW)).toBe('');
    });
  });

  describe('error cases', () => {
    it('rejects unknown keyword', () => {
      expect(() => expandTokens('__YESTERDAY__', NOW)).toThrow(
        RelativeDateTokenError,
      );
    });

    it('rejects malformed offset unit', () => {
      expect(() => expandTokens('__TODAY__-7x', NOW)).toThrow(
        RelativeDateTokenError,
      );
    });

    it('rejects amount over the 10-year bound', () => {
      expect(() => expandTokens('__TODAY__-9999d', NOW)).toThrow(
        /exceeds bound/,
      );
    });

    it('rejects hour unit on __TODAY__', () => {
      expect(() => expandTokens('__TODAY__-2h', NOW)).toThrow(
        /not allowed on __TODAY__/,
      );
    });

    it('rejects minute unit on __TODAY__', () => {
      expect(() => expandTokens('__TODAY__+5m', NOW)).toThrow(
        /not allowed on __TODAY__/,
      );
    });

    it('attaches column and rowIndex to the error when supplied', () => {
      try {
        expandTokens('__TODAY__-7x', NOW, 'check_in_date', 3);
      } catch (e) {
        expect(e).toBeInstanceOf(RelativeDateTokenError);
        const err = e as RelativeDateTokenError;
        expect(err.column).toBe('check_in_date');
        expect(err.rowIndex).toBe(3);
        expect(err.message).toContain('check_in_date');
        return;
      }
      throw new Error('expected throw');
    });
  });

  // ── Compound offsets ────────────────────────────────────────────
  //
  // First surfaced on pnkndvyy (2026-05-15): the bookings seed CSV used
  // compound tokens like `__NOW__-1d+2h` to place calendar-anchored events
  // relative to deploy time. The original single-offset grammar threw
  // RelativeDateTokenError on every compound, and r2-seeder.ts:544-547
  // caught the error and `continue`d — silently dropping the entire
  // dataset (`deployment-status-preview.json::seeded` short by one).
  describe('compound offsets', () => {
    it('expands __NOW__-1d+2h as a single delta', () => {
      // 1d back + 2h forward = 22h back.
      expect(expandTokens('__NOW__-1d+2h', NOW)).toBe(
        '2026-05-07T14:00:00.000Z',
      );
    });

    it('expands __NOW__+2d+16h', () => {
      // 2d forward + 16h forward = 64h forward.
      expect(expandTokens('__NOW__+2d+16h', NOW)).toBe(
        '2026-05-11T04:00:00.000Z',
      );
    });

    it('expands __NOW__-1mo+3d (month + day mix)', () => {
      // Month-shift first (calendar-aware), then 3 days forward.
      expect(expandTokens('__NOW__-1mo+3d', NOW)).toBe(
        '2026-04-11T12:00:00.000Z',
      );
    });

    it('rejects compound offset with invalid unit', () => {
      // Trailing `+2x` makes the whole token shape invalid; lookbehind
      // hits looksLikeBrokenToken and we throw a malformed token error.
      expect(() => expandTokens('__NOW__-1d+2x', NOW)).toThrow(
        RelativeDateTokenError,
      );
    });

    it('rejects hour unit in compound offset on __TODAY__', () => {
      // Even when wrapped in a compound, `h` on TODAY stays illegal.
      expect(() => expandTokens('__TODAY__-2d+1h', NOW)).toThrow(
        /not allowed on __TODAY__/,
      );
    });

    it('rejects truncated compound token __NOW__-', () => {
      // No digits/unit after the sign — looksLikeBrokenToken catches it.
      expect(() => expandTokens('__NOW__-', NOW)).toThrow(
        RelativeDateTokenError,
      );
    });

    it('preserves existing single-offset behaviour', () => {
      // The compound grammar widening must not regress single offsets.
      expect(expandTokens('__NOW__-2h', NOW)).toBe('2026-05-08T10:00:00.000Z');
      expect(expandTokens('__TODAY__-7d', NOW)).toBe('2026-05-01');
    });
  });
});


describe('expandRecords', () => {
  it('expands tokenised cells across all records and columns', () => {
    const records = [
      { id: 1, check_in: '__TODAY__-3d', name: 'Eleanor' },
      { id: 2, check_in: '__TODAY__-1d', name: 'Luke' },
    ];
    const { records: out, expanded } = expandRecords(records, ['id', 'check_in', 'name'], NOW);

    expect(out).toEqual([
      { id: 1, check_in: '2026-05-05', name: 'Eleanor' },
      { id: 2, check_in: '2026-05-07', name: 'Luke' },
    ]);
    expect(expanded).toBe(true);
  });

  it('does not mutate the input records', () => {
    const records = [{ id: 1, day: '__TODAY__' }];
    const before = JSON.stringify(records);
    expandRecords(records, ['id', 'day'], NOW);
    expect(JSON.stringify(records)).toBe(before);
  });

  it('passes through non-token cells untouched', () => {
    const records = [
      { id: 1, name: 'Alice', balance: 99.5, day: '__TODAY__' },
    ];
    const { records: out } = expandRecords(records, ['id', 'name', 'balance', 'day'], NOW);
    expect(out[0].id).toBe(1);
    expect(out[0].name).toBe('Alice');
    expect(out[0].balance).toBe(99.5);
    expect(out[0].day).toBe('2026-05-08');
  });

  it('reports expanded=false when no cell contained a token', () => {
    const records = [
      { id: 1, name: 'Alice', day: '2026-01-01' },
      { id: 2, name: 'Bob', day: '2026-02-15' },
    ];
    const { records: out, expanded } = expandRecords(records, ['id', 'name', 'day'], NOW);
    expect(expanded).toBe(false);
    expect(out).toEqual(records);
  });

  it('drops the failing row and continues — per-row tolerance', () => {
    // Previously this would throw and the caller dropped the entire
    // dataset. Per-row tolerance keeps the good rows; bad rows surface
    // in `errors`. First surfaced on alo48zsn (2026-05-15).
    const records = [
      { id: 1, day: '__TODAY__' },
      { id: 2, day: '__TODAY__-7x' }, // bad: unknown unit
      { id: 3, day: '__TODAY__-1d' },
    ];
    const { records: out, errors } = expandRecords(records, ['id', 'day'], NOW);
    expect(out).toEqual([
      { id: 1, day: '2026-05-08' },
      { id: 3, day: '2026-05-07' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('row 1');
    expect(errors[0]).toMatch(/__TODAY__-7x|malformed/);
  });

  it('drops the row when __TODAY__ has an hour offset (illegal unit)', () => {
    // The exact alo48zsn failure: __TODAY__+8h is illegal because `h`
    // is only valid on __NOW__. Bookings row 2 had this pattern; the
    // whole dataset was silently dropped before the per-row fix.
    const records = [
      { id: 1, start: '__NOW__-2h', end: '__NOW__+1h' },
      { id: 2, start: '__TODAY__', end: '__TODAY__+8h' }, // illegal
      { id: 3, start: '__NOW__+3h', end: '__NOW__+5h' },
    ];
    const { records: out, errors } = expandRecords(records, ['id', 'start', 'end'], NOW);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1);
    expect(out[1].id).toBe(3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('row 1');
    expect(errors[0]).toMatch(/unit 'h' is not allowed on __TODAY__/);
  });

  it('reports no errors when every row is valid', () => {
    const records = [
      { id: 1, day: '__TODAY__' },
      { id: 2, day: '__TODAY__-7d' },
    ];
    const { records: out, errors } = expandRecords(records, ['id', 'day'], NOW);
    expect(out).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  it('returns empty records + all errors when every row fails', () => {
    const records = [
      { id: 1, day: '__TODAY__-1x' },
      { id: 2, day: '__TODAY__+2y' },
    ];
    const { records: out, errors } = expandRecords(records, ['id', 'day'], NOW);
    expect(out).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it('preserves column/row context inside the error message', () => {
    const records = [
      { id: 1, day: '__TODAY__' },
      { id: 2, day: '__BOGUS__' }, // bad
    ];
    const { errors } = expandRecords(records, ['id', 'day'], NOW);
    expect(errors).toHaveLength(1);
    // RelativeDateTokenError.message includes column + rowIndex.
    expect(errors[0]).toContain('row 1');
    expect(errors[0]).toContain('day');
  });

  it('skips columns that don\'t appear in a row', () => {
    // Sparse records — columns lists more cols than every row has.
    const records = [{ id: 1, day: '__TODAY__' }];
    const { records: out } = expandRecords(records, ['id', 'day', 'extra_col'], NOW);
    expect(out[0].day).toBe('2026-05-08');
    expect('extra_col' in out[0]).toBe(false);
  });

  it('handles empty record list', () => {
    expect(expandRecords([], ['x'], NOW)).toEqual({
      records: [],
      expanded: false,
      errors: [],
    });
  });
});
