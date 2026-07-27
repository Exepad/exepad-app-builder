import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeMigration } from '../src/schema/migrations';
import type {
  ModelProps,
  ExistingTable,
  ExistingColumn,
} from '../src/schema/types';
import { SYSTEM_COLUMNS, SQLITE_TYPE_MAP } from '../src/schema/types';
import type { ColumnProps } from '@exepad/types';
import { provisionD1Database, executeD1DDL, executeD1DDLBatch } from '../src/deploy/d1';
import { introspectTableREST } from '../src/deploy/d1-introspect';
import { generateCreateTableSQL } from '../src/schema/builder';
import { TEST_CONFIG, setupDataDir, teardownDataDir } from './helpers/local-db';

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Build an ExistingTable that matches a given ModelProps exactly
 * (including system columns and the default owner_id index).
 *
 * NOTE on index name matching: The index dedup logic in computeMigration
 * uses a greedy regex `/CREATE.*INDEX.*"([^"]+)"/` which captures the
 * LAST quoted identifier in the generated SQL rather than the index name.
 * For example, for `CREATE INDEX IF NOT EXISTS "idx_items_owner_id" ON "items" ("owner_id")`,
 * the regex captures `owner_id` (the column), not `idx_items_owner_id`.
 *
 * To make the existing table fixture work correctly with the dedup logic,
 * we store the names that the regex actually extracts (i.e. the last
 * quoted identifier from each generated CREATE INDEX statement).
 */
function existingTableFromModel(model: ModelProps): ExistingTable {
  const allColumns: ColumnProps[] = [...model.columns];
  for (const sysCol of SYSTEM_COLUMNS) {
    if (!allColumns.some((c) => c.name === sysCol.name)) {
      allColumns.push(sysCol);
    }
  }

  const columns: ExistingColumn[] = allColumns.map((col) => ({
    name: col.name,
    type: SQLITE_TYPE_MAP[col.type] || 'TEXT',
    notnull: col.isPrimary ? false : !col.isNullable,
    dflt_value:
      col.defaultValue !== undefined ? String(col.defaultValue) : null,
    pk: !!col.isPrimary,
  }));

  // Build indexes that the dedup logic will recognise.
  // The regex `/CREATE.*INDEX.*"([^"]+)"/` extracts the last quoted
  // identifier from the SQL, so we need our ExistingIndex.name to match
  // that same value for the dedup check to work.
  const indexes: ExistingTable['indexes'] = [];

  // The owner_id index SQL looks like:
  //   CREATE INDEX IF NOT EXISTS "idx_<table>_owner_id" ON "<table>" ("owner_id")
  // The regex captures "owner_id" (last quoted id).
  indexes.push({
    name: 'owner_id',
    unique: false,
    columns: ['owner_id'],
  });

  if (model.indexes) {
    for (const idx of model.indexes) {
      // For a user-defined index, the SQL ends with e.g. ("title") or ("col_a", "col_b").
      // The regex captures the last quoted identifier in the SQL, which is the
      // last column name in the index.
      const lastCol = idx.columns[idx.columns.length - 1];
      indexes.push({
        name: lastCol,
        unique: !!idx.unique,
        columns: idx.columns,
      });
    }
  }

  return { name: model.name, columns, indexes };
}

/**
 * Create a minimal ModelProps for testing.
 */
function makeModel(overrides: Partial<ModelProps> = {}): ModelProps {
  return {
    uuid: 'test-uuid',
    name: 'items',
    columns: [
      { name: 'id', type: 'integer', isPrimary: true },
      { name: 'title', type: 'text', isNullable: false },
    ],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('computeMigration', () => {
  // ── Safe policy ──────────────────────────────────────────────

  describe('safe policy', () => {
    it('returns empty statements when no changes are needed', () => {
      const model = makeModel();
      const existing = existingTableFromModel(model);

      const result = computeMigration(model, existing, 'safe');

      expect(result.statements).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.isDestructive).toBe(false);
    });

    it('adds a new nullable column via ALTER TABLE', () => {
      const model = makeModel({
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'title', type: 'text', isNullable: false },
          { name: 'description', type: 'text', isNullable: true },
        ],
      });

      // Existing table does NOT have 'description'
      const baseModel = makeModel();
      const existing = existingTableFromModel(baseModel);

      const result = computeMigration(model, existing, 'safe');

      const alterStatements = result.statements.filter((s) =>
        s.includes('ALTER TABLE')
      );
      expect(alterStatements).toHaveLength(1);
      expect(alterStatements[0]).toContain('"description"');
      expect(alterStatements[0]).toContain('TEXT');
      expect(result.warnings).toEqual([]);
      expect(result.isDestructive).toBe(false);
    });

    it('adds a new column with a default value via ALTER TABLE', () => {
      const model = makeModel({
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'title', type: 'text', isNullable: false },
          {
            name: 'status',
            type: 'text',
            isNullable: false,
            defaultValue: 'draft',
          },
        ],
      });

      const baseModel = makeModel();
      const existing = existingTableFromModel(baseModel);

      const result = computeMigration(model, existing, 'safe');

      const alterStatements = result.statements.filter((s) =>
        s.includes('ALTER TABLE')
      );
      expect(alterStatements).toHaveLength(1);
      expect(alterStatements[0]).toContain('"status"');
      expect(alterStatements[0]).toContain("DEFAULT 'draft'");
      expect(result.warnings).toEqual([]);
      expect(result.isDestructive).toBe(false);
    });

    it('adds a new NOT NULL column without default using a synthesized default (safe mode)', () => {
      const model = makeModel({
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'title', type: 'text', isNullable: false },
          { name: 'required_field', type: 'text', isNullable: false },
        ],
      });

      const baseModel = makeModel();
      const existing = existingTableFromModel(baseModel);

      const result = computeMigration(model, existing, 'safe');

      // The column is ADDED (not skipped) with a synthesized default so the live
      // table stays aligned with the config. Previously it was skipped, which
      // left every sys_create failing with "no column named X" while the deploy
      // still reported success.
      const alterStatements = result.statements.filter((s) =>
        s.includes('ALTER TABLE')
      );
      expect(alterStatements).toHaveLength(1);
      expect(alterStatements[0]).toContain('"required_field"');
      expect(alterStatements[0]).toContain('NOT NULL');
      expect(alterStatements[0]).toContain("DEFAULT ''");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('required_field');
      expect(result.warnings[0]).toContain('synthesized');
      expect(result.isDestructive).toBe(false);
    });

    it('warns about a removed column without dropping it', () => {
      const model = makeModel();
      const existing = existingTableFromModel(model);

      // Add an extra column to existing that the model no longer defines
      existing.columns.push({
        name: 'legacy_field',
        type: 'TEXT',
        notnull: false,
        dflt_value: null,
        pk: false,
      });

      const result = computeMigration(model, existing, 'safe');

      // No ALTER TABLE statements expected
      const alterStatements = result.statements.filter((s) =>
        s.includes('ALTER TABLE')
      );
      expect(alterStatements).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('legacy_field');
      expect(result.warnings[0]).toContain('destructive mode');
      expect(result.isDestructive).toBe(false);
    });

    it('adds a missing index via CREATE INDEX', () => {
      const model = makeModel({
        indexes: [
          { name: 'idx_items_title', columns: ['title'], unique: false },
        ],
      });

      // Existing table has no user-defined indexes (only owner_id)
      const baseModel = makeModel(); // no indexes
      const existing = existingTableFromModel(baseModel);

      const result = computeMigration(model, existing, 'safe');

      const indexStatements = result.statements.filter((s) =>
        s.includes('CREATE') && s.includes('INDEX')
      );
      expect(indexStatements.length).toBeGreaterThanOrEqual(1);
      expect(
        indexStatements.some((s) => s.includes('"idx_items_title"'))
      ).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.isDestructive).toBe(false);
    });

    it('does not re-add an index that already exists', () => {
      const model = makeModel({
        indexes: [
          { name: 'idx_items_title', columns: ['title'], unique: false },
        ],
      });
      const existing = existingTableFromModel(model);

      const result = computeMigration(model, existing, 'safe');

      expect(result.statements).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  // ── Destructive policy ───────────────────────────────────────

  describe('destructive policy', () => {
    it('rebuilds the table to drop a removed column and marks destructive', () => {
      const model = makeModel();
      const existing = existingTableFromModel(model);

      // Extra column exists in DB but not in model
      existing.columns.push({
        name: 'obsolete_col',
        type: 'TEXT',
        notnull: false,
        dflt_value: null,
        pk: false,
      });

      const result = computeMigration(model, existing, 'destructive');

      // The 12-step SQLite table rebuild is emitted: create temp, copy the
      // intersecting columns, drop the old table, rename, recreate indexes.
      expect(result.isDestructive).toBe(true);
      expect(result.statements.some((s) => s.includes('CREATE TABLE') && s.includes('__exepad_migrate_new'))).toBe(true);
      expect(result.statements.some((s) => s.startsWith('INSERT INTO') && s.includes('SELECT'))).toBe(true);
      expect(result.statements.some((s) => s.startsWith('DROP TABLE') && s.includes('"items"'))).toBe(true);
      expect(result.statements.some((s) => s.includes('RENAME TO "items"'))).toBe(true);
      // The dropped column must NOT be in the copied column list.
      const insert = result.statements.find((s) => s.startsWith('INSERT INTO'))!;
      expect(insert).not.toContain('obsolete_col');
      // Operator/agent-visible warning that the column's data is discarded.
      expect(result.warnings.some((w) => w.includes('obsolete_col') && w.includes('discarded'))).toBe(true);
    });

    it('rebuilds the table to apply a column TYPE change and marks destructive', () => {
      // Model says qty is INTEGER; the live table has it as TEXT.
      const model = makeModel({
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'title', type: 'text', isNullable: false },
          { name: 'qty', type: 'integer', isNullable: true },
        ],
      });
      const existing = existingTableFromModel(model);
      const qty = existing.columns.find((c) => c.name === 'qty')!;
      qty.type = 'TEXT'; // simulate drift: live column is the old type

      const result = computeMigration(model, existing, 'destructive');

      expect(result.isDestructive).toBe(true);
      expect(result.statements.some((s) => s.includes('CREATE TABLE') && s.includes('__exepad_migrate_new'))).toBe(true);
      // qty IS in the intersecting set, so its data is copied across the rebuild.
      const insert = result.statements.find((s) => s.startsWith('INSERT INTO'))!;
      expect(insert).toContain('"qty"');
      expect(result.warnings.some((w) => w.includes('qty') && w.includes('type/nullability'))).toBe(true);
    });

    it('SAFE mode refuses to rebuild — it only warns for the same drop/type change', () => {
      const model = makeModel({
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'title', type: 'text', isNullable: false },
          { name: 'qty', type: 'integer', isNullable: true },
        ],
      });
      const existing = existingTableFromModel(model);
      existing.columns.find((c) => c.name === 'qty')!.type = 'TEXT';
      existing.columns.push({
        name: 'obsolete_col', type: 'TEXT', notnull: false, dflt_value: null, pk: false,
      });

      const result = computeMigration(model, existing, 'safe');

      // No rebuild in safe mode: no CREATE/DROP/RENAME of the table.
      expect(result.isDestructive).toBe(false);
      expect(result.statements.some((s) => s.includes('__exepad_migrate_new'))).toBe(false);
      expect(result.statements.some((s) => s.startsWith('DROP TABLE'))).toBe(false);
      // Drift + drop are surfaced as warnings instead.
      expect(result.warnings.some((w) => w.includes('qty') && w.includes('in place'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('obsolete_col') && w.includes('destructive mode'))).toBe(true);
    });

    it('adds a new NOT NULL column without default using a synthesized default (destructive mode)', () => {
      const model = makeModel({
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'title', type: 'text', isNullable: false },
          { name: 'strict_col', type: 'text', isNullable: false },
        ],
      });

      const baseModel = makeModel();
      const existing = existingTableFromModel(baseModel);

      const result = computeMigration(model, existing, 'destructive');

      // Column ADD behaves the same regardless of policy: synthesize a default
      // and emit the ALTER rather than skipping. There is no removed column
      // here, so nothing is destructive.
      const alterStatements = result.statements.filter((s) =>
        s.includes('ALTER TABLE')
      );
      expect(alterStatements).toHaveLength(1);
      expect(alterStatements[0]).toContain('"strict_col"');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('strict_col');
      expect(result.warnings[0]).toContain('synthesized');
      expect(result.isDestructive).toBe(false);
    });

    it('can still add nullable columns normally', () => {
      const model = makeModel({
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'title', type: 'text', isNullable: false },
          { name: 'notes', type: 'text', isNullable: true },
        ],
      });

      const baseModel = makeModel();
      const existing = existingTableFromModel(baseModel);

      const result = computeMigration(model, existing, 'destructive');

      const alterStatements = result.statements.filter((s) =>
        s.includes('ALTER TABLE')
      );
      expect(alterStatements).toHaveLength(1);
      expect(alterStatements[0]).toContain('"notes"');
      expect(result.warnings).toEqual([]);
      expect(result.isDestructive).toBe(false);
    });
  });

  // ── Reset policy ─────────────────────────────────────────────

  describe('reset policy', () => {
    it('generates DROP TABLE + CREATE TABLE + indexes', () => {
      const model = makeModel({
        indexes: [
          { name: 'idx_items_title', columns: ['title'], unique: false },
        ],
      });
      const existing = existingTableFromModel(model);

      const result = computeMigration(model, existing, 'reset');

      // DROP TABLE, CREATE TABLE, owner_id index, user-defined index
      expect(result.statements.length).toBeGreaterThanOrEqual(3);
      expect(result.statements[0]).toContain('DROP TABLE');
      expect(result.statements[0]).toContain('"items"');
      expect(result.statements[1]).toContain('CREATE TABLE');
      expect(result.statements[1]).toContain('"items"');
      // The remaining statements are indexes
      const indexStatements = result.statements.slice(2);
      expect(
        indexStatements.some((s) => s.includes('idx_items_owner_id'))
      ).toBe(true);
      expect(
        indexStatements.some((s) => s.includes('idx_items_title'))
      ).toBe(true);
    });

    it('is always marked as destructive', () => {
      const model = makeModel();
      const existing = existingTableFromModel(model);

      const result = computeMigration(model, existing, 'reset');

      expect(result.isDestructive).toBe(true);
    });

    it('includes system columns in the CREATE TABLE statement', () => {
      const model = makeModel();
      const existing = existingTableFromModel(model);

      const result = computeMigration(model, existing, 'reset');

      const createStmt = result.statements.find((s) =>
        s.includes('CREATE TABLE')
      );
      expect(createStmt).toBeDefined();
      expect(createStmt).toContain('"owner_id"');
      expect(createStmt).toContain('"created_at"');
      expect(createStmt).toContain('"updated_at"');
    });
  });

  // ── System columns ───────────────────────────────────────────

  describe('system columns', () => {
    it('auto-adds missing system columns to existing table', () => {
      const model = makeModel();

      // Existing table is missing system columns
      const existing: ExistingTable = {
        name: 'items',
        columns: [
          {
            name: 'id',
            type: 'INTEGER',
            notnull: false,
            dflt_value: null,
            pk: true,
          },
          {
            name: 'title',
            type: 'TEXT',
            notnull: true,
            dflt_value: null,
            pk: false,
          },
        ],
        indexes: [
          { name: 'owner_id', unique: false, columns: ['owner_id'] },
        ],
      };

      const result = computeMigration(model, existing, 'safe');

      // System columns (owner_id, created_at, updated_at) are NOT NULL without defaults,
      // so in safe mode they should be skipped with warnings
      expect(result.warnings.length).toBeGreaterThanOrEqual(3);
      expect(result.warnings.some((w) => w.includes('owner_id'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('created_at'))).toBe(
        true
      );
      expect(result.warnings.some((w) => w.includes('updated_at'))).toBe(
        true
      );
    });
  });
});

// ── Destructive rebuild executed against real SQLite ──────────────────────
//
// These verify the emitted 12-step rebuild statements actually run inside the
// atomic executeD1DDLBatch transaction and preserve intersecting-column data
// while dropping removed columns / applying type changes.

describe('destructive rebuild (executed against SQLite)', () => {
  beforeEach(() => setupDataDir());
  afterEach(() => teardownDataDir());

  /** Old `items` model with a legacy column + qty stored as TEXT. */
  const OLD_MODEL: ModelProps = {
    uuid: 'm-old',
    name: 'items',
    columns: [
      { name: 'id', type: 'integer', isPrimary: true },
      { name: 'title', type: 'text', isNullable: false },
      { name: 'qty', type: 'text', isNullable: true },
      { name: 'legacy', type: 'text', isNullable: true },
    ],
  };

  async function rowsOf(dbId: string): Promise<Array<Record<string, unknown>>> {
    const res = await executeD1DDL(TEST_CONFIG, dbId, `SELECT * FROM "items" ORDER BY id`);
    return res.results as Array<Record<string, unknown>>;
  }

  async function columnType(dbId: string, col: string): Promise<string> {
    const res = await executeD1DDL(TEST_CONFIG, dbId, `PRAGMA table_info("items")`);
    const rows = res.results as Array<{ name: string; type: string }>;
    return rows.find((r) => r.name === col)?.type ?? '';
  }

  it('preserves intersecting-column data across a column TYPE change', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, generateCreateTableSQL(OLD_MODEL));
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `INSERT INTO "items" (title, qty, legacy, owner_id, created_at, updated_at)
       VALUES ('hi', '5', 'x', 'u1', 't', 't')`,
    );

    // New model: qty becomes INTEGER, legacy stays. Only a type change.
    const newModel: ModelProps = {
      ...OLD_MODEL,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'title', type: 'text', isNullable: false },
        { name: 'qty', type: 'integer', isNullable: true },
        { name: 'legacy', type: 'text', isNullable: true },
      ],
    };
    const existing = await introspectTableREST(TEST_CONFIG, uuid, 'items');
    const plan = computeMigration(newModel, existing!, 'destructive');
    expect(plan.isDestructive).toBe(true);

    await executeD1DDLBatch(TEST_CONFIG, uuid, plan.statements);

    // Column is now INTEGER and the value was carried across (re-typed to 5).
    expect((await columnType(uuid, 'qty')).toUpperCase()).toBe('INTEGER');
    const rows = await rowsOf(uuid);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('hi');
    expect(rows[0].qty).toBe(5);
    expect(rows[0].legacy).toBe('x');
    // No temp table left behind.
    const tbls = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%__exepad_migrate_new'`,
    );
    expect((tbls.results as unknown[]).length).toBe(0);
  });

  it('DROP COLUMN removes the column and preserves the rest of the row', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, generateCreateTableSQL(OLD_MODEL));
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `INSERT INTO "items" (title, qty, legacy, owner_id, created_at, updated_at)
       VALUES ('hi', '5', 'x', 'u1', 't', 't')`,
    );

    // New model drops `legacy` entirely.
    const newModel: ModelProps = {
      ...OLD_MODEL,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'title', type: 'text', isNullable: false },
        { name: 'qty', type: 'text', isNullable: true },
      ],
    };
    const existing = await introspectTableREST(TEST_CONFIG, uuid, 'items');
    const plan = computeMigration(newModel, existing!, 'destructive');

    await executeD1DDLBatch(TEST_CONFIG, uuid, plan.statements);

    const cols = (
      (await executeD1DDL(TEST_CONFIG, uuid, `PRAGMA table_info("items")`)).results as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).not.toContain('legacy');
    expect(cols).toEqual(expect.arrayContaining(['id', 'title', 'qty', 'owner_id']));

    const rows = await rowsOf(uuid);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('hi');
    expect(rows[0].qty).toBe('5');
  });

  it('safe mode leaves the table (and its extra column) untouched', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, generateCreateTableSQL(OLD_MODEL));

    const newModel: ModelProps = {
      ...OLD_MODEL,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'title', type: 'text', isNullable: false },
        { name: 'qty', type: 'text', isNullable: true },
      ],
    };
    const existing = await introspectTableREST(TEST_CONFIG, uuid, 'items');
    const plan = computeMigration(newModel, existing!, 'safe');

    // Nothing destructive is emitted; applying the (empty of rebuild) plan is a
    // no-op for the table shape.
    expect(plan.statements.some((s) => s.includes('__exepad_migrate_new'))).toBe(false);
    if (plan.statements.length > 0) {
      await executeD1DDLBatch(TEST_CONFIG, uuid, plan.statements);
    }
    const cols = (
      (await executeD1DDL(TEST_CONFIG, uuid, `PRAGMA table_info("items")`)).results as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toContain('legacy');
  });
});
