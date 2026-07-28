import { describe, it, expect } from 'vitest';
import { areComponentsEqual } from './componentComparison';
import type { ComponentProps } from '@/app_runtime/interfaces/components/common/core';

/**
 * Regression guard for the array-prop comparison in shallowPropsEqual.
 *
 * The previous heuristic only compared the first 3 elements of an array prop by
 * reference, so replacing an element at index >= 3 with a same-length array was
 * wrongly reported as "equal" — the memoized list (nav items, gallery images)
 * then rendered stale content. areComponentsEqual must now detect a change at
 * ANY index.
 */
describe('areComponentsEqual — array prop comparison', () => {
  const base = (items: unknown[]): ComponentProps =>
    ({
      uuid: 'c1',
      componentType: 'Nav',
      items,
    }) as unknown as ComponentProps;

  it('detects a replaced element beyond index 2', () => {
    const shared = { id: 3 };
    const prev = [{ id: 0 }, { id: 1 }, { id: 2 }, shared, { id: 4 }];
    // Same length, first 3 elements identical by reference, index 3 replaced.
    const next = [prev[0], prev[1], prev[2], { id: 3 }, prev[4]];

    expect(areComponentsEqual([base(prev)], [base(next)])).toBe(false);
  });

  it('treats identical-by-reference arrays as equal', () => {
    const items = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(areComponentsEqual([base(items)], [base([...items])])).toBe(true);
  });

  it('detects a length change', () => {
    const items = [{ id: 0 }, { id: 1 }];
    expect(areComponentsEqual([base(items)], [base(items.slice(0, 1))])).toBe(false);
  });
});
