/**
 * Relative-date token expansion for seed data.
 *
 * Seed CSV / JSON cells matching the token grammar are evaluated at
 * deploy time so generated apps can ship "recent" data regardless of
 * when the agent ran. The agent emits tokens like `__TODAY__-7d`; the
 * deploy pipeline rewrites them to actual dates anchored to `Date.now()`.
 *
 * Without this, an agent running on May 1 generates `2026-04-25` for
 * yesterday's date; if the user deploys on May 7, handlers filtering on
 * "this month" find nothing because the seed data is in last month.
 *
 * ## Token grammar
 *
 *     token       := date_token | datetime_token
 *     date_token  := "__TODAY__" offsets?
 *     datetime_tok:= "__NOW__"   offsets?
 *     offsets     := offset+
 *     offset      := sign amount unit
 *     sign        := "+" | "-"
 *     amount      := digit+
 *     unit        := "d" | "w" | "mo" | "h" | "m"
 *
 * Rules:
 *
 * - `__TODAY__` formats as `YYYY-MM-DD` (UTC).
 * - `__NOW__` formats as ISO 8601 UTC with millisecond precision.
 * - `h` and `m` units are illegal on `__TODAY__` (hard error).
 * - `|amount| ≤ 3650` (10-year bound) — anything larger throws.
 * - `mo` does calendar-add with end-of-month clamping
 *   (Jan 31 + 1mo = Feb 28 in non-leap years).
 * - Compound offsets are supported: `__NOW__-1d+2h` is now minus 22h;
 *   `__NOW__+2d+16h` is now plus 64h. Each `[+-]N<unit>` segment is
 *   applied in order. (First surfaced on pnkndvyy 2026-05-15: the
 *   bookings seed CSV used compound offsets to place calendar-anchored
 *   bookings; the original single-offset grammar threw and the whole
 *   dataset was silently dropped at deploy time.)
 * - The whole cell must match exactly. `"Welcome to __TODAY__"` and
 *   other partial matches pass through unchanged so app-domain text
 *   never collides with the grammar.
 * - Unrecognised tokens (`"__YESTERDAY__"`, `"__TODAY__-7x"`) throw
 *   `RelativeDateTokenError` with column + row context for fast triage.
 *
 * Non-string cell values (numbers, booleans, null, nested objects)
 * pass through unchanged.
 */


export class RelativeDateTokenError extends Error {
  constructor(
    public readonly token: string,
    public readonly reason: string,
    public readonly column?: string,
    public readonly rowIndex?: number,
  ) {
    const where =
      column !== undefined && rowIndex !== undefined
        ? ` (column=${column}, row=${rowIndex})`
        : '';
    super(`Invalid seed token "${token}": ${reason}${where}`);
    this.name = 'RelativeDateTokenError';
  }
}


// Strict whole-cell match. Captures: 1=keyword (TODAY|NOW),
// 2=concatenated offset string (optional, e.g. "-1d+2h" or "+5d").
// The offset string is parsed segment-by-segment with OFFSET_PART_RE.
const TOKEN_RE = /^__(TODAY|NOW)__((?:[+-]\d+(?:d|w|mo|h|m))+)?$/;

// Per-offset parser: walks the captured offset string left-to-right and
// yields one segment per ``g`` exec call. Capture groups: 1=sign,
// 2=amount, 3=unit.
const OFFSET_PART_RE = /([+-])(\d+)(d|w|mo|h|m)/g;

const MAX_AMOUNT = 3650;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;


/**
 * Try to expand a single value. Non-strings pass through unchanged.
 * Strings that don't match the token grammar pass through unchanged
 * (no greedy substitution — partial matches like "Welcome to
 * __TODAY__" are domain text, not tokens).
 *
 * Throws `RelativeDateTokenError` for malformed tokens (`__TODAY__-7x`,
 * `__YESTERDAY__`, etc.) — we'd rather surface seed bugs at deploy
 * time than emit obviously-wrong data.
 */
export function expandTokens(
  value: unknown,
  now: Date,
  column?: string,
  rowIndex?: number,
): unknown {
  if (typeof value !== 'string') return value;

  // Fast path: strings without any `__` marker can't be tokens or
  // typo'd token attempts. Skip parsing entirely for the common case.
  if (!value.includes('__')) return value;

  const match = TOKEN_RE.exec(value);
  if (!match) {
    // String contains a marker but doesn't match exactly. Two cases:
    //   1. Trailing/leading characters: probably domain text — pass through.
    //   2. Malformed offset (`__TODAY__-7x`): definitely a typo — throw.
    // We detect (2) by checking whether the string starts with `__TODAY__`
    // or `__NOW__` and otherwise looks like a token attempt.
    if (looksLikeBrokenToken(value)) {
      throw new RelativeDateTokenError(value, 'malformed token', column, rowIndex);
    }
    return value;
  }

  const keyword = match[1];
  const offsetStr = match[2];

  let offsetMs = 0;
  let monthsToAdd = 0;
  if (offsetStr) {
    OFFSET_PART_RE.lastIndex = 0;
    let part: RegExpExecArray | null;
    while ((part = OFFSET_PART_RE.exec(offsetStr)) !== null) {
      const sign = part[1];
      const amountStr = part[2];
      const unit = part[3];

      if (keyword === 'TODAY' && (unit === 'h' || unit === 'm')) {
        throw new RelativeDateTokenError(
          value,
          `unit '${unit}' is not allowed on __TODAY__ (use __NOW__)`,
          column,
          rowIndex,
        );
      }

      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount > MAX_AMOUNT) {
        throw new RelativeDateTokenError(
          value,
          `amount ${amountStr} exceeds bound ${MAX_AMOUNT}`,
          column,
          rowIndex,
        );
      }
      const signed = sign === '-' ? -amount : amount;
      if (unit === 'mo') {
        monthsToAdd += signed;
      } else {
        offsetMs +=
          signed *
          (unit === 'd' ? MS_PER_DAY :
           unit === 'w' ? 7 * MS_PER_DAY :
           unit === 'h' ? MS_PER_HOUR :
           /* unit === 'm' */ MS_PER_MINUTE);
      }
    }
  }

  // Apply both month and ms offsets — month first (with calendar-aware
  // clamping), then ms (a fixed time delta). Compound tokens like
  // `__NOW__-1mo+3d` need both legs.
  let target = monthsToAdd !== 0 ? addMonthsUTC(now, monthsToAdd) : now;
  if (offsetMs !== 0) target = new Date(target.getTime() + offsetMs);

  return keyword === 'TODAY' ? formatDate(target) : target.toISOString();
}


/**
 * Walk every cell of every record and replace tokens with absolute
 * values. Mutation-free: returns a new array of new record objects so
 * callers can swap them in safely.
 *
 * The `expanded` flag tells the caller whether at least one cell was
 * substituted. Downstream passes that re-anchor dates (e.g.
 * `shiftDatesToPresent`) should skip datasets where `expanded === true`,
 * since tokens are already deploy-time-anchored and a second shift would
 * pull them backward.
 *
 * Per-row tolerance: errors are collected per row in `errors[]` and the
 * failing row is dropped from `records[]`. Other rows still expand and
 * insert. Previously a single bad token (e.g. `__TODAY__+8h`, illegal
 * because `h` requires `__NOW__`) would throw and the caller would
 * drop the ENTIRE dataset — silent total data loss. First surfaced on
 * app `alo48zsn` (2026-05-15) where one bad row in `bookings.csv` left
 * the whole table empty even though 4 of 5 rows were fine.
 */
export function expandRecords(
  records: readonly Record<string, unknown>[],
  columns: readonly string[],
  now: Date,
): { records: Record<string, unknown>[]; expanded: boolean; errors: string[] } {
  const out: Record<string, unknown>[] = [];
  const errors: string[] = [];
  let expanded = false;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    try {
      const next: Record<string, unknown> = { ...record };
      for (const col of columns) {
        if (!(col in next)) continue;
        const before = next[col];
        const after = expandTokens(before, now, col, i);
        if (after !== before) expanded = true;
        next[col] = after;
      }
      out.push(next);
    } catch (e) {
      const msg = e instanceof RelativeDateTokenError
        ? e.message
        : e instanceof Error
        ? e.message
        : String(e);
      errors.push(`row ${i}: ${msg}`);
      // Drop the failing row; continue with the rest.
    }
  }
  return { records: out, expanded, errors };
}


// ── Helpers ──────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}


function addMonthsUTC(base: Date, months: number): Date {
  // SQLite/JS month arithmetic with end-of-month clamping. Jan 31 +
  // 1 month should yield Feb 28 (or 29 in leap years), not Mar 3.
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const targetMonthAbs = month + months;
  const targetYear = year + Math.floor(targetMonthAbs / 12);
  const normalisedMonth = ((targetMonthAbs % 12) + 12) % 12;

  // Clamp day to the target month's last valid day.
  const lastDay = new Date(Date.UTC(targetYear, normalisedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);

  return new Date(
    Date.UTC(
      targetYear,
      normalisedMonth,
      clampedDay,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}


// Detect a clear "I meant a token" attempt that isn't valid. Catches
// both unknown keywords (`__YESTERDAY__`) and malformed offsets
// (`__TODAY__-7x`). Free-text containing the substring `__TODAY__` in
// a sentence still passes through cleanly.
const BROKEN_TOKEN_RE = /^__[A-Za-z]+__/;


/**
 * Heuristic: did the LLM clearly intend a token but get the syntax wrong?
 *
 * Returns true for cells that *start* with a `__WORD__` marker — those
 * are almost always token attempts (unknown keyword, bad unit, typo).
 * Free-text cells that contain `__TODAY__` somewhere in the middle of
 * a sentence don't trip this — they pass through.
 */
function looksLikeBrokenToken(value: string): boolean {
  return BROKEN_TOKEN_RE.test(value.trim());
}
