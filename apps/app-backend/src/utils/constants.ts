/**
 * Shared constants for the app-backend
 */

/** Columns managed by the system — users cannot set or update these directly */
export const SYSTEM_COLUMNS = ['id', 'owner_id', 'created_at', 'updated_at', 'deleted_at'] as const;

/** Subset of system columns that must never be updated (updated_at IS allowed in SET clauses) */
export const PROTECTED_UPDATE_FIELDS = ['id', 'owner_id', 'created_at'] as const;

/** Allowed operators for filter conditions in list/count queries */
export const VALID_FILTER_OPERATORS = ['gt', 'gte', 'lt', 'lte', 'ne', 'like', 'ilike'] as const;

/** Maximum number of items in an array filter (IN clause) */
export const MAX_FILTER_ARRAY_SIZE = 100;
