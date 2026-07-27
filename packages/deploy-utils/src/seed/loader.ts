/**
 * Seed Data Types
 *
 * Shape of a parsed seed dataset (model name + rows + detected columns).
 * The filesystem CSV/JSON loader that used to live here was superseded by
 * `r2-seeder.ts` (reads seed files from object storage and inserts via the
 * deploy pipeline) and `static-resolver.ts` (inlines non-model datasets).
 */

/**
 * Parsed seed data
 */
export interface SeedData {
  /** Model name */
  modelName: string;

  /** Parsed records */
  records: Record<string, unknown>[];

  /** Column names detected */
  columns: string[];

  /** Parse warnings */
  warnings: string[];
}
