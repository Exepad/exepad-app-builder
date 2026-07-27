/**
 * Field Validation Edge Cases
 *
 * Tests for type validation, null/empty handling, numeric edge cases,
 * and type coercion — covers gaps identified in BUG-2, BUG-8, BUG-9.
 */

import { describe, it, expect } from 'vitest';
import {
  validateCreateInput,
  validateUpdateInput,
  coerceInputTypes,
  autoDateColumnDefault,
  creationTimestampColumnDefault,
  applyAutoDateDefaults,
} from '../src/utils/validation';
import type { ModelProps, ColumnProps } from '../src/types/env';

// ── Test Models ──────────────────────────────────────────────────

/** Model with one column of each type for targeted type validation */
const ALL_TYPES_MODEL: ModelProps = {
  uuid: 'all-types',
  name: 'samples',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'label', type: 'text' },
    { name: 'count', type: 'integer', isNullable: true },
    { name: 'score', type: 'real', isNullable: true },
    { name: 'data', type: 'blob', isNullable: true },
    { name: 'metadata', type: 'json', isNullable: true },
  ],
};

/** Model with non-nullable fields of various types */
const STRICT_MODEL: ModelProps = {
  uuid: 'strict',
  name: 'strict_records',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'title', type: 'text' },
    { name: 'amount', type: 'integer' },
    { name: 'rate', type: 'real' },
    { name: 'payload', type: 'blob' },
  ],
};

/** Model with nullable text column */
const NULLABLE_TEXT_MODEL: ModelProps = {
  uuid: 'nullable-text',
  name: 'notes',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'title', type: 'text' },
    { name: 'body', type: 'text', isNullable: true },
  ],
};

// ── validateColumnType (via validateUpdateInput) ─────────────────

describe('Field type validation edge cases', () => {
  describe('null handling', () => {
    it('rejects null on non-nullable text with "cannot be null"', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { label: null });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('label');
      expect(errors[0].message).toContain('cannot be null');
    });

    it('rejects null on non-nullable integer with "cannot be null"', () => {
      const errors = validateUpdateInput(STRICT_MODEL, { amount: null });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('amount');
      expect(errors[0].message).toContain('cannot be null');
    });

    it('rejects null on non-nullable real with "cannot be null"', () => {
      const errors = validateUpdateInput(STRICT_MODEL, { rate: null });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('rate');
      expect(errors[0].message).toContain('cannot be null');
    });

    it('rejects null on non-nullable blob with "cannot be null"', () => {
      const errors = validateUpdateInput(STRICT_MODEL, { payload: null });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('payload');
      expect(errors[0].message).toContain('cannot be null');
    });

    it('allows null on nullable text', () => {
      const errors = validateUpdateInput(NULLABLE_TEXT_MODEL, { body: null });
      expect(errors).toHaveLength(0);
    });

    it('allows null on nullable integer', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { count: null });
      expect(errors).toHaveLength(0);
    });

    it('allows null on nullable real', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { score: null });
      expect(errors).toHaveLength(0);
    });

    it('allows null on nullable json', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { metadata: null });
      expect(errors).toHaveLength(0);
    });
  });

  describe('empty string handling', () => {
    it('allows empty string on non-nullable text (valid TEXT value in SQLite)', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { label: '' });
      expect(errors).toHaveLength(0);
    });

    it('allows empty string on nullable text', () => {
      const errors = validateUpdateInput(NULLABLE_TEXT_MODEL, { body: '' });
      expect(errors).toHaveLength(0);
    });
  });

  describe('NaN and Infinity on real columns', () => {
    it('rejects NaN on real column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { score: NaN });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('score');
      expect(errors[0].message).toContain('finite number');
    });

    it('rejects Infinity on real column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { score: Infinity });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('score');
      expect(errors[0].message).toContain('finite number');
    });

    it('rejects -Infinity on real column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { score: -Infinity });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('score');
      expect(errors[0].message).toContain('finite number');
    });

    it('accepts -0 on real column (valid finite number)', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { score: -0 });
      expect(errors).toHaveLength(0);
    });

    it('accepts 0.0 on real column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { score: 0.0 });
      expect(errors).toHaveLength(0);
    });

    it('accepts 3.14 on real column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { score: 3.14 });
      expect(errors).toHaveLength(0);
    });
  });

  describe('NaN and unsafe integers on integer columns', () => {
    it('rejects NaN on integer column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { count: NaN });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('count');
      expect(errors[0].message).toContain('safe integer');
    });

    it('accepts 0 on integer column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { count: 0 });
      expect(errors).toHaveLength(0);
    });

    it('accepts negative integers', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { count: -42 });
      expect(errors).toHaveLength(0);
    });

    it('accepts Number.MAX_SAFE_INTEGER', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, {
        count: Number.MAX_SAFE_INTEGER,
      });
      expect(errors).toHaveLength(0);
    });

    it('rejects Number.MAX_SAFE_INTEGER + 1 (unsafe integer)', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, {
        count: Number.MAX_SAFE_INTEGER + 1,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('safe integer');
    });

    it('rejects 3.14 on integer column (not an integer)', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { count: 3.14 });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('safe integer');
    });
  });

  describe('type mismatches', () => {
    it('rejects boolean on integer column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { count: true });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('got boolean');
    });

    it('rejects array on integer column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, {
        count: [1, 2, 3],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('got object');
    });

    it('rejects object on text column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { label: {} });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('got object');
    });

    it('rejects number on text column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { label: 42 });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('got number');
    });

    it('rejects string on integer column (uncoerced)', () => {
      // In the CRUD pipeline, coerceInputTypes runs first. This tests
      // validateUpdateInput directly with an uncoerced string value.
      const errors = validateUpdateInput(ALL_TYPES_MODEL, {
        count: 'not a number',
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('got string');
    });

    it('rejects number on blob column', () => {
      const errors = validateUpdateInput(ALL_TYPES_MODEL, { data: 123 });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('got number');
    });

    it('accepts any value for json column', () => {
      expect(
        validateUpdateInput(ALL_TYPES_MODEL, { metadata: 'string' })
      ).toHaveLength(0);
      expect(
        validateUpdateInput(ALL_TYPES_MODEL, { metadata: 42 })
      ).toHaveLength(0);
      expect(
        validateUpdateInput(ALL_TYPES_MODEL, { metadata: true })
      ).toHaveLength(0);
      expect(
        validateUpdateInput(ALL_TYPES_MODEL, { metadata: [1, 2] })
      ).toHaveLength(0);
      expect(
        validateUpdateInput(ALL_TYPES_MODEL, { metadata: { key: 'val' } })
      ).toHaveLength(0);
    });
  });
});

// ── coerceInputTypes ─────────────────────────────────────────────

describe('coerceInputTypes edge cases', () => {
  describe('integer coercion from string', () => {
    it('coerces "123" to 123', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: '123' });
      expect(result.count).toBe(123);
    });

    it('coerces "1e10" (scientific notation) to 10000000000', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: '1e10' });
      expect(result.count).toBe(10_000_000_000);
    });

    it('coerces "  123  " (with whitespace) to 123', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: '  123  ' });
      expect(result.count).toBe(123);
    });

    it('coerces "+42" to 42', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: '+42' });
      expect(result.count).toBe(42);
    });

    it('coerces "0xFF" (hex) to 255', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: '0xFF' });
      expect(result.count).toBe(255);
    });

    it('coerces "0o77" (octal string) to 63', () => {
      // Number("0o77") = 63 in modern JS; 63 is a safe integer → coerced
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: '0o77' });
      expect(result.count).toBe(63);
    });

    it('does NOT coerce "3.14" for integer (not a safe integer)', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: '3.14' });
      expect(result.count).toBe('3.14');
    });

    it('does NOT coerce empty string for integer', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: '' });
      expect(result.count).toBe('');
    });

    it('leaves already-number value unchanged', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: 42 });
      expect(result.count).toBe(42);
    });

    it('does NOT coerce string to unsafe integer', () => {
      // Number.MAX_SAFE_INTEGER + 1 as a string — Number() gives the value
      // but Number.isSafeInteger() returns false, so no coercion
      const unsafe = String(Number.MAX_SAFE_INTEGER + 1);
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: unsafe });
      expect(result.count).toBe(unsafe);
    });
  });

  describe('real coercion from string', () => {
    it('coerces "3.14" to 3.14', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { score: '3.14' });
      expect(result.score).toBe(3.14);
    });

    it('coerces "0" to 0', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { score: '0' });
      expect(result.score).toBe(0);
    });

    it('does NOT coerce "Infinity"', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { score: 'Infinity' });
      expect(result.score).toBe('Infinity');
    });

    it('does NOT coerce "-Infinity"', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { score: '-Infinity' });
      expect(result.score).toBe('-Infinity');
    });

    it('does NOT coerce "NaN"', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { score: 'NaN' });
      expect(result.score).toBe('NaN');
    });

    it('does NOT coerce empty string for real', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { score: '' });
      expect(result.score).toBe('');
    });

    it('leaves already-number value unchanged', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { score: 2.718 });
      expect(result.score).toBe(2.718);
    });
  });

  describe('non-numeric columns', () => {
    it('does not coerce text columns', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { label: '123' });
      expect(result.label).toBe('123');
    });

    it('does not coerce json columns', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { metadata: '123' });
      expect(result.metadata).toBe('123');
    });

    it('does not coerce blob columns', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { data: '123' });
      expect(result.data).toBe('123');
    });

    it('passes through fields not in model columns unchanged', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { unknown_field: '42' });
      expect(result.unknown_field).toBe('42');
    });
  });

  describe('null/undefined handling', () => {
    it('passes null through without coercion', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: null });
      expect(result.count).toBeNull();
    });

    it('passes undefined through without coercion', () => {
      const result = coerceInputTypes(ALL_TYPES_MODEL, { count: undefined });
      expect(result.count).toBeUndefined();
    });
  });
});

// ── validateCreateInput ──────────────────────────────────────────

describe('validateCreateInput edge cases', () => {
  it('rejects system columns in data', () => {
    const errors = validateCreateInput(ALL_TYPES_MODEL, {
      label: 'test',
      owner_id: 'hacker',
      created_at: '2024-01-01',
    });
    const systemErrors = errors.filter((e) =>
      e.message.includes('system-managed')
    );
    expect(systemErrors).toHaveLength(2);
    expect(systemErrors.map((e) => e.field)).toContain('owner_id');
    expect(systemErrors.map((e) => e.field)).toContain('created_at');
  });

  it('rejects primary key (id) as system field', () => {
    const errors = validateCreateInput(ALL_TYPES_MODEL, {
      id: 1,
      label: 'test',
    });
    expect(
      errors.some(
        (e) => e.field === 'id' && e.message.includes('system-managed')
      )
    ).toBe(true);
  });

  it('collects multiple error types: unknown field + type mismatch + missing required', () => {
    const errors = validateCreateInput(ALL_TYPES_MODEL, {
      unknown_field: 'x',
      count: 'not a number',
    });
    // unknown_field → Unknown field error
    expect(
      errors.some(
        (e) => e.field === 'unknown_field' && e.message.includes('Unknown')
      )
    ).toBe(true);
    // label is required but missing
    expect(
      errors.some(
        (e) => e.field === 'label' && e.message.includes('Required')
      )
    ).toBe(true);
    // count received a string (uncoerced) — type error
    expect(errors.some((e) => e.field === 'count')).toBe(true);
  });

  it('reports all null errors on non-nullable model with all fields null', () => {
    const errors = validateCreateInput(STRICT_MODEL, {
      title: null,
      amount: null,
      rate: null,
      payload: null,
    });
    const nullErrors = errors.filter((e) =>
      e.message.includes('cannot be null')
    );
    expect(nullErrors).toHaveLength(4);
  });

  it('skips required check for primary key column', () => {
    // id is not provided but shouldn't be required (auto-generated PK)
    const errors = validateCreateInput(ALL_TYPES_MODEL, {
      label: 'test',
    });
    expect(errors.some((e) => e.field === 'id')).toBe(false);
  });

  it('does not require nullable fields', () => {
    // Only label is required in ALL_TYPES_MODEL; others are nullable
    const errors = validateCreateInput(ALL_TYPES_MODEL, {
      label: 'test',
    });
    expect(errors).toHaveLength(0);
  });

  it('does not require fields with defaultValue', () => {
    const modelWithDefault: ModelProps = {
      uuid: 'defaults',
      name: 'settings',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'key', type: 'text' },
        { name: 'value', type: 'text', defaultValue: 'default' },
      ],
    };
    const errors = validateCreateInput(modelWithDefault, { key: 'test' });
    expect(errors).toHaveLength(0);
  });
});

// ── validateUpdateInput ──────────────────────────────────────────

describe('validateUpdateInput edge cases', () => {
  it('allows partial update with one valid field', () => {
    const errors = validateUpdateInput(ALL_TYPES_MODEL, {
      label: 'updated',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects updated_at as system column', () => {
    const errors = validateUpdateInput(ALL_TYPES_MODEL, {
      updated_at: '2024-01-01',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('updated_at');
    expect(errors[0].message).toContain('system-managed');
  });

  it('rejects deleted_at as system column', () => {
    const errors = validateUpdateInput(ALL_TYPES_MODEL, {
      deleted_at: '2024-01-01',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('deleted_at');
    expect(errors[0].message).toContain('system-managed');
  });

  it('returns no errors for empty object', () => {
    const errors = validateUpdateInput(ALL_TYPES_MODEL, {});
    expect(errors).toHaveLength(0);
  });

  it('rejects null on non-nullable field in update', () => {
    const errors = validateUpdateInput(ALL_TYPES_MODEL, { label: null });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('cannot be null');
  });

  it('rejects unknown field in update', () => {
    const errors = validateUpdateInput(ALL_TYPES_MODEL, {
      nonexistent: 'value',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Unknown');
  });
});

describe('autoDateColumnDefault', () => {
  const col = (extra: Record<string, unknown>): ColumnProps =>
    ({ name: 'c', type: 'text', ...extra }) as unknown as ColumnProps;

  it('returns an ISO date for a __TODAY__-token vocabulary (both casings)', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(autoDateColumnDefault(col({ enumValues: ['__TODAY__-14d', '__TODAY__'] }))).toBe(today);
    // snake_case drift (as seen in real generated schemas) still recognised.
    expect(autoDateColumnDefault(col({ enum_values: ['__TODAY__-30d'] }))).toBe(today);
  });

  it('returns a full ISO timestamp for a __NOW__-token vocabulary', () => {
    const v = autoDateColumnDefault(col({ enumValues: ['__NOW__-2h', '__NOW__'] }));
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('returns null for a real enum (not date tokens) — never auto-defaults a status', () => {
    expect(autoDateColumnDefault(col({ enumValues: ['healthy', 'watch', 'sick'] }))).toBeNull();
    // Mixed: one real value among tokens is NOT an auto-date column.
    expect(autoDateColumnDefault(col({ enumValues: ['__TODAY__-1d', 'someday'] }))).toBeNull();
    // No vocabulary at all.
    expect(autoDateColumnDefault(col({}))).toBeNull();
    expect(autoDateColumnDefault(col({ enumValues: [] }))).toBeNull();
  });

  it('declines FUTURE-dated tokens (user-scheduled dates), leaving them required', () => {
    // A reservation/due/event date spread into the future must NOT be silently
    // stamped "now" — that would persist the wrong day and hide the missing form
    // field. It stays required so the create surfaces the gap.
    expect(autoDateColumnDefault(col({ enumValues: ['__TODAY__+3d', '__TODAY__+7d'] }))).toBeNull();
    expect(autoDateColumnDefault(col({ enumValues: ['__NOW__+2h'] }))).toBeNull();
    // Any future offset in the vocabulary disqualifies the whole column.
    expect(autoDateColumnDefault(col({ enumValues: ['__TODAY__-1d', '__TODAY__+1d'] }))).toBeNull();
  });
});

describe('creationTimestampColumnDefault', () => {
  const col = (name: string, extra: Record<string, unknown> = {}): ColumnProps =>
    ({ name, type: 'text', ...extra }) as unknown as ColumnProps;

  it('stamps today (date-only) for an unambiguous creation-timestamp NAME', () => {
    const today = new Date().toISOString().slice(0, 10);
    // The token-free companion: after the agent seed sampler stops leaking date
    // tokens into enum_values, the NAME keeps date_added auto-filling instead of
    // 400-ing. Always date-only, even for `_at`, to avoid granularity drift.
    expect(creationTimestampColumnDefault(col('date_added'))).toBe(today);
    expect(creationTimestampColumnDefault(col('added_on'))).toBe(today);
    expect(creationTimestampColumnDefault(col('created_date'))).toBe(today);
    expect(creationTimestampColumnDefault(col('added_at'))).toBe(today); // date-only, not ISO ts
    expect(creationTimestampColumnDefault(col('entry_added_date'))).toBe(today);
  });

  it('declines ambiguous participle event-date names (review-narrowed)', () => {
    // Narrowed to {added, created} after adversarial review: posted/logged/
    // recorded/reported/entered/captured/joined/registered/submitted frequently
    // name a user-CHOSEN real-world date, so stamping today would persist a
    // wrong day and mask a missing form field. They stay required (surface the gap).
    for (const n of [
      'posted_date', 'logged_at', 'recorded_date', 'reported_at', 'entered_on',
      'captured_at', 'joined_date', 'registered_on', 'submitted_date',
    ]) {
      expect(creationTimestampColumnDefault(col(n))).toBeNull();
    }
  });

  it('defers to autoDateColumnDefault whenever ANY enum vocabulary is present', () => {
    // Regression (review Finding 1): a future-dated token column that
    // autoDateColumnDefault DELIBERATELY declines must NOT be re-stamped by the
    // name path just because the name reads creational. Any vocabulary → bow out.
    expect(
      creationTimestampColumnDefault(col('created_date', { enumValues: ['__TODAY__+7d'] }))
    ).toBeNull();
    expect(
      creationTimestampColumnDefault(col('date_added', { enum_values: ['__TODAY__+30d'] }))
    ).toBeNull();
    // A genuine (non-date) enum on a creational name is deferred too, never stamped.
    expect(
      creationTimestampColumnDefault(col('added_date', { enumValues: ['q1', 'q2'] }))
    ).toBeNull();
  });

  it('declines user-chosen / scheduled dates', () => {
    for (const n of ['due_date', 'start_date', 'scheduled_at', 'expiry_date', 'birth_date', 'checkout_date']) {
      expect(creationTimestampColumnDefault(col(n))).toBeNull();
    }
  });

  it('requires BOTH a creation word AND a date word (no false positives)', () => {
    expect(creationTimestampColumnDefault(col('added_reason'))).toBeNull(); // no date word
    expect(creationTimestampColumnDefault(col('event_date'))).toBeNull(); // no creation word
    expect(creationTimestampColumnDefault(col('visit_day'))).toBeNull();
    expect(creationTimestampColumnDefault(col('title'))).toBeNull();
    expect(creationTimestampColumnDefault(col(''))).toBeNull();
  });
});

describe('applyAutoDateDefaults', () => {
  it('fills only missing NOT NULL past-date columns; respects every guard', () => {
    const model = {
      uuid: 'm',
      name: 'm',
      columns: [
        { name: 'created', type: 'text', enumValues: ['__TODAY__-1d'] }, // → filled
        { name: 'due', type: 'text', enumValues: ['__TODAY__+7d'] }, // future → skip
        { name: 'opt', type: 'text', isNullable: true, enumValues: ['__TODAY__-1d'] }, // nullable → skip
        { name: 'seeded', type: 'text', defaultValue: 'x', enumValues: ['__TODAY__-1d'] }, // has default → skip
        { name: 'present', type: 'text', enumValues: ['__TODAY__-1d'] }, // already present → skip
      ],
    } as unknown as ModelProps;
    const data: Record<string, unknown> = { present: '2020-01-01' };

    applyAutoDateDefaults(model, data);

    const today = new Date().toISOString().slice(0, 10);
    expect(data.created).toBe(today);
    expect('due' in data).toBe(false); // future date stays required (will 400)
    expect('opt' in data).toBe(false);
    expect('seeded' in data).toBe(false);
    expect(data.present).toBe('2020-01-01'); // untouched
  });

  it('fills a name-signalled creation-timestamp column; skips system/typed/scheduled/nullable', () => {
    // The post-Fix-A world: the agent no longer samples date tokens into the
    // enum, so date_added arrives as a plain NOT NULL text column and its NAME
    // keeps it auto-filling. Review Finding 4: never stamp a system column, and
    // confine the name path to text so an integer field never gets an ISO string.
    const model = {
      uuid: 'books',
      name: 'books',
      columns: [
        { name: 'title', type: 'text' }, // required, present
        { name: 'date_added', type: 'text' }, // creation-named text → filled today
        { name: 'due_date', type: 'text' }, // scheduled → stays required
        { name: 'created_at', type: 'text' }, // SYSTEM column → skip (auto-managed)
        { name: 'added_at', type: 'integer' }, // creation-named but non-text → skip
        { name: 'notes', type: 'text', isNullable: true }, // nullable → skip
      ],
    } as unknown as ModelProps;
    const data: Record<string, unknown> = { title: 'Dune' };

    applyAutoDateDefaults(model, data);

    const today = new Date().toISOString().slice(0, 10);
    expect(data.date_added).toBe(today);
    expect('due_date' in data).toBe(false);
    expect('created_at' in data).toBe(false);
    expect('added_at' in data).toBe(false);
    expect('notes' in data).toBe(false);
  });
});
