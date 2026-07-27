/**
 * SQL query utilities for D1 admin routes.
 */

/**
 * Escape user input for safe use in a `LIKE ? ESCAPE '\'` clause.
 * Prevents wildcard injection via `%` and `_` in free-text search params.
 *
 * Always pair with `ESCAPE '\'` in the SQL: `... LIKE ? ESCAPE '\'`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
