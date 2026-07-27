/**
 * Unit tests for the pure FK-dependency seed ordering (no DB / no mocks).
 */
import { describe, it, expect } from 'vitest';
import { planSeedOrder } from '../src/seed/seed-order';

type Entries = Record<string, { model: string }>;
type FkRefs = Map<string, Array<{ referencedModel: string }>>;

const entries = (...models: string[]): Entries =>
  Object.fromEntries(models.map((m) => [m, { model: m }]));

const fk = (pairs: Record<string, string[]>): FkRefs => {
  const map: FkRefs = new Map();
  for (const [model, refs] of Object.entries(pairs)) {
    map.set(model, refs.map((referencedModel) => ({ referencedModel })));
  }
  return map;
};

describe('planSeedOrder', () => {
  it('orders a parent→child chain: parents insert first, children delete first', () => {
    // loans references books + members
    const plan = planSeedOrder(
      entries('books', 'members', 'loans'),
      fk({ loans: ['books', 'members'] }),
    );
    expect(plan.cyclic).toBe(false);
    expect(plan.insertOrder).toEqual(['books', 'members', 'loans']);
    expect(plan.deleteOrder).toEqual(['loans', 'members', 'books']);
  });

  it('reorders a mis-ordered config so children still come last', () => {
    // config lists the child first
    const plan = planSeedOrder(
      entries('loans', 'members', 'books'),
      fk({ loans: ['books', 'members'] }),
    );
    expect(plan.cyclic).toBe(false);
    // loans must be inserted last and deleted first regardless of config order
    expect(plan.insertOrder[plan.insertOrder.length - 1]).toBe('loans');
    expect(plan.deleteOrder[0]).toBe('loans');
    expect(plan.insertOrder.slice(0, 2).sort()).toEqual(['books', 'members']);
  });

  it('falls back to config order on a 2-cycle and flags cyclic', () => {
    const plan = planSeedOrder(
      entries('departments', 'employees'),
      fk({ departments: ['employees'], employees: ['departments'] }),
    );
    expect(plan.cyclic).toBe(true);
    expect(plan.insertOrder).toEqual(['departments', 'employees']);
    expect(plan.deleteOrder).toEqual(['employees', 'departments']);
  });

  it('handles a diamond (A→B, A→C, B→D, C→D)', () => {
    const plan = planSeedOrder(
      entries('a', 'b', 'c', 'd'),
      fk({ b: ['a'], c: ['a'], d: ['b', 'c'] }),
    );
    expect(plan.cyclic).toBe(false);
    const idx = (m: string) => plan.insertOrder.indexOf(m);
    expect(idx('a')).toBeLessThan(idx('b'));
    expect(idx('a')).toBeLessThan(idx('c'));
    expect(idx('b')).toBeLessThan(idx('d'));
    expect(idx('c')).toBeLessThan(idx('d'));
  });

  it('ignores self-references (no spurious cycle)', () => {
    const plan = planSeedOrder(
      entries('employees', 'departments'),
      fk({ employees: ['employees'] }), // manager_id → employees
    );
    expect(plan.cyclic).toBe(false);
    expect(plan.insertOrder).toEqual(['employees', 'departments']);
  });

  it('ignores edges to models that have no seed entry', () => {
    // loans → books (no books entry) and loans → categories (seeded)
    const plan = planSeedOrder(
      entries('loans', 'categories'),
      fk({ loans: ['books', 'categories'] }),
    );
    expect(plan.cyclic).toBe(false);
    expect(plan.insertOrder.indexOf('categories')).toBeLessThan(plan.insertOrder.indexOf('loans'));
  });

  it('orders an FK-less leaf parent before its children', () => {
    // books has no FK columns (absent from the fk map) but must precede loans
    const plan = planSeedOrder(
      entries('loans', 'books'),
      fk({ loans: ['books'] }),
    );
    expect(plan.cyclic).toBe(false);
    expect(plan.insertOrder).toEqual(['books', 'loans']);
  });

  it('returns config order for a single entry', () => {
    const plan = planSeedOrder(entries('only'), new Map());
    expect(plan).toEqual({ insertOrder: ['only'], deleteOrder: ['only'], cyclic: false });
  });
});
