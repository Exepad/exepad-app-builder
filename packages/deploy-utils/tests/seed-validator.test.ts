/**
 * Seed Validator Tests
 *
 * Fix 2 (HIGH): ensure CSV headers match the model schema. Prevents silent
 * column drops that caused task-001's seed data mismatch.
 */

import { describe, it, expect } from 'vitest';
import {
  validateSeedAgainstModel,
  formatSeedValidationError,
} from '../src/seed/validator';
import type { ModelProps } from '../src/schema/types';
import type { SeedData } from '../src/seed/loader';

function makeSeed(columns: string[]): SeedData {
  return {
    modelName: 'orders',
    records: [],
    columns,
    warnings: [],
  };
}

const ORDERS_MODEL: ModelProps = {
  name: 'orders',
  columns: [
    { name: 'customer_name', type: 'text', isNullable: false },
    { name: 'total', type: 'real', isNullable: false },
    { name: 'status', type: 'text', isNullable: false, defaultValue: 'pending' },
    { name: 'note', type: 'text', isNullable: true },
  ],
};

describe('validateSeedAgainstModel', () => {
  it('accepts a CSV with exactly the declared columns', () => {
    const result = validateSeedAgainstModel(
      makeSeed(['customer_name', 'total', 'status', 'note']),
      ORDERS_MODEL
    );
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.blocking)).toHaveLength(0);
  });

  it('accepts a CSV that omits columns with defaults or nullable', () => {
    // note is nullable, status has default — CSV may omit them.
    const result = validateSeedAgainstModel(
      makeSeed(['customer_name', 'total']),
      ORDERS_MODEL
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a CSV with columns the model does not declare', () => {
    const result = validateSeedAgainstModel(
      makeSeed(['customer_name', 'total', 'discount_code']),
      ORDERS_MODEL
    );
    expect(result.valid).toBe(false);
    const blocking = result.issues.find((i) => i.blocking && i.message.includes('discount_code'));
    expect(blocking).toBeDefined();
  });

  it('rejects a CSV that is missing a required non-null column', () => {
    const result = validateSeedAgainstModel(
      makeSeed(['customer_name']),  // missing `total` which is NOT NULL no-default
      ORDERS_MODEL
    );
    expect(result.valid).toBe(false);
    const blocking = result.issues.find((i) => i.blocking && i.message.includes('total'));
    expect(blocking).toBeDefined();
  });

  it('ignores system columns (owner_id/created_at/updated_at/id/deleted_at)', () => {
    const result = validateSeedAgainstModel(
      makeSeed([
        'customer_name',
        'total',
        'id',
        'owner_id',
        'created_at',
        'updated_at',
        'deleted_at',
      ]),
      ORDERS_MODEL
    );
    expect(result.valid).toBe(true);
  });

  it('reports extras and missing in one result', () => {
    const result = validateSeedAgainstModel(
      makeSeed(['customer_name', 'unexpected_col']), // missing `total`, extra `unexpected_col`
      ORDERS_MODEL
    );
    expect(result.valid).toBe(false);
    const messages = result.issues.filter((i) => i.blocking).map((i) => i.message).join('\n');
    expect(messages).toContain('unexpected_col');
    expect(messages).toContain('total');
  });
});

describe('formatSeedValidationError', () => {
  it('returns a multi-line message naming the offending columns', () => {
    const result = validateSeedAgainstModel(
      makeSeed(['customer_name', 'discount_code']),
      ORDERS_MODEL
    );
    const text = formatSeedValidationError(result);
    expect(text).toContain("model 'orders'");
    expect(text).toMatch(/discount_code/);
    expect(text).toMatch(/total/);
  });

  it('returns a "passed" message for valid seeds', () => {
    const result = validateSeedAgainstModel(
      makeSeed(['customer_name', 'total']),
      ORDERS_MODEL
    );
    const text = formatSeedValidationError(result);
    expect(text).toMatch(/passed/);
  });
});
