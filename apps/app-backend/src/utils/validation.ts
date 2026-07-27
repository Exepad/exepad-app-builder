/**
 * Input Validation Utilities
 */

import { z } from 'zod';
import type { ModelProps, ColumnProps, HandlerProps, InputProps } from '../types/env';
import { SYSTEM_COLUMNS } from './constants';

/**
 * Validation error structure
 */
export interface FieldError {
  field: string;
  message: string;
}

/** Matches a relative-date SEED token: `__TODAY__`, `__NOW__`, with optional
 * offsets (`__TODAY__-14d`, `__NOW__+2h`). The planner emits these to spread
 * seed rows over time; the seed pipeline resolves them at deploy. */
const SEED_DATE_TOKEN = /^__(TODAY|NOW)__/;

/**
 * Concrete default for an "auto-managed date" column, or null if the column is
 * not one.
 *
 * The planner sometimes emits a NOT NULL date column (e.g. `date_added`) whose
 * declared vocabulary is ENTIRELY relative-date seed tokens (`["__TODAY__-14d",
 * "__TODAY__-30d", ...]`) — used to spread the seed rows across time. If the
 * generated create form does not collect that column (the user's spec listed no
 * date field), every user-driven create would otherwise 400 as "required field
 * missing". A column whose whole vocabulary is relative-date tokens is
 * semantically an auto-managed timestamp, so a freshly-created row should
 * default to today / now rather than be rejected.
 *
 * Returns an ISO date (`YYYY-MM-DD`) for a `__TODAY__`-based column, a full ISO
 * timestamp for a `__NOW__`-based one, or null when the column is not an
 * auto-managed creation timestamp. Reads both `enumValues` (canonical) and the
 * snake_case `enum_values` some agent output drifts to.
 *
 * Scope guard: only PAST/today/now tokens qualify. A vocabulary with a FUTURE
 * offset (`__TODAY__+7d`, `__NOW__+2h`) marks a user-scheduled date — a due
 * date, reservation, event — that the user is meant to choose. Silently
 * stamping such a column with "now" would persist the wrong day and hide the
 * fact that the form is missing a field the user needs, so we decline it and
 * let the create reject as required (which surfaces the real form-gen gap).
 */
export function autoDateColumnDefault(column: ColumnProps): string | null {
  const raw =
    column.enumValues ?? (column as { enum_values?: unknown }).enum_values;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const allDateTokens = raw.every(
    (v) => typeof v === 'string' && SEED_DATE_TOKEN.test(v)
  );
  if (!allDateTokens) return null;
  // Future-dated vocabulary → user-scheduled date, not a creation timestamp.
  if ((raw as string[]).some((v) => v.includes('+'))) return null;
  const now = new Date();
  // A `__NOW__`-based vocabulary implies time-of-day precision; `__TODAY__` is
  // date-only.
  const wantsTime = (raw as string[]).some((v) => v.startsWith('__NOW__'));
  return wantsTime ? now.toISOString() : now.toISOString().slice(0, 10);
}

/** Name tokens that unambiguously mark WHEN a row entered the system. Kept
 * deliberately tiny: only `added`/`created` clearly mean "auto-fill to today
 * when the form omits it". Past-participle words like `posted`/`logged`/
 * `recorded`/`reported`/`entered`/`captured`/`joined` are excluded — they
 * routinely name a user-CHOSEN real-world event date (a post's publish date, a
 * manually-logged past event), and silently stamping those with today would
 * persist a wrong day and mask the missing form field. Those stay required. */
const CREATION_NAME_WORDS = new Set(['created', 'added']);
/** Name tokens that mark date/time-ness (so a plain text field named
 * "added_reason" isn't mistaken for a timestamp). */
const DATE_NAME_WORDS = new Set([
  'date',
  'time',
  'datetime',
  'timestamp',
  'at',
  'on',
  'day',
]);
/** Name tokens that mark a USER-CHOSEN date (a due/scheduled/event date the
 * form is meant to collect) — never auto-stamp these. Mirrors the future-token
 * guard in autoDateColumnDefault. */
const SCHEDULING_NAME_WORDS = new Set([
  'due',
  'start',
  'starts',
  'end',
  'ends',
  'scheduled',
  'schedule',
  'expire',
  'expires',
  'expiry',
  'expiration',
  'deadline',
  'reservation',
  'appointment',
  'reminder',
  'target',
  'valid',
  'renew',
  'renewal',
  'next',
  'eta',
  'arrival',
  'departure',
  'checkin',
  'checkout',
  'birth',
  'dob',
  'anniversary',
  'planned',
  'booking',
  'booked',
]);

/**
 * Concrete "today" default for a column whose NAME marks it as a creation
 * timestamp, or null otherwise. This is the token-free companion to
 * autoDateColumnDefault: the agent's seed-enum sampler no longer leaks
 * relative-date tokens into a date column's vocabulary (that pollution used to
 * be the only signal), so a NOT NULL creation-date column the form omits needs
 * a name-based signal to keep auto-filling instead of 400-ing.
 *
 * Deliberately conservative on three axes:
 *  - The name must carry BOTH a creation word (`added`/`created`) AND a date
 *    word (`date`/`at`/`on`…), and NO scheduling word (`due`/`start`/…) — so a
 *    user-chosen date stays required and surfaces the real form-generation gap.
 *  - A column that carries ANY enum vocabulary is left to autoDateColumnDefault:
 *    it is either a genuine closed vocabulary or a relative-date TOKEN column,
 *    and for future-dated tokens that function DELIBERATELY declines (returns
 *    null). The name path must not override that decline, so it bows out
 *    whenever a vocabulary is present.
 *  - Always date-only (`YYYY-MM-DD`). A name-derived column has no time-of-day
 *    signal, and matching autoDateColumnDefault's `__NOW__` timestamp precision
 *    here would give two identically-meant columns different granularity and
 *    break equality/range filters on the stored text.
 */
export function creationTimestampColumnDefault(column: ColumnProps): string | null {
  // A column with any declared vocabulary is autoDateColumnDefault's domain.
  const enumRaw =
    column.enumValues ?? (column as { enum_values?: unknown }).enum_values;
  if (Array.isArray(enumRaw) && enumRaw.length > 0) return null;
  const tokens = column.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const has = (set: Set<string>) => tokens.some((t) => set.has(t));
  if (has(SCHEDULING_NAME_WORDS)) return null;
  if (!has(CREATION_NAME_WORDS) || !has(DATE_NAME_WORDS)) return null;
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mutates `data` in place, filling any NOT NULL "auto-managed date" column that
 * is absent from the payload and has no defaultValue. Recognizes such a column
 * by its relative-date token vocabulary (autoDateColumnDefault, legacy/deployed
 * apps) OR by creation-timestamp name semantics (creationTimestampColumnDefault,
 * the token-free signal). Shared by every create-class path (sysCreate /
 * sysUpsert / sysBatch) so a NOT NULL creation-timestamp column the form doesn't
 * collect must not 400 on any of them. System columns (id/owner_id/created_at/…)
 * are auto-managed elsewhere and never stamped here; the name path is confined
 * to text columns so an integer epoch field never receives an ISO string.
 */
export function applyAutoDateDefaults(
  model: ModelProps,
  data: Record<string, unknown>
): void {
  for (const col of model.columns) {
    if (col.isNullable || col.defaultValue !== undefined || col.name in data) continue;
    if ((SYSTEM_COLUMNS as readonly string[]).includes(col.name)) continue;
    const isTextish = col.type === 'text' || col.type === undefined;
    const autoDate =
      autoDateColumnDefault(col) ??
      (isTextish ? creationTimestampColumnDefault(col) : null);
    if (autoDate !== null) data[col.name] = autoDate;
  }
}

/**
 * Coerce input data types based on model schema
 * Converts string values to proper types (e.g., "123" -> 123 for integer columns)
 */
export function coerceInputTypes(
  model: ModelProps,
  data: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  
  for (const column of model.columns) {
    if (!(column.name in data)) continue;
    
    const value = data[column.name];
    
    // Skip null/undefined
    if (value === null || value === undefined) continue;
    
    // Coerce boolean → integer (SQLite stores flags as 0/1)
    if (typeof value === 'boolean' && (column.type === 'integer' || column.type === 'real')) {
      result[column.name] = value ? 1 : 0;
      continue;
    }

    // Convert string to number for numeric columns
    if (typeof value === 'string') {
      // Skip empty strings — leave for downstream validation to reject
      if (value === '') continue;

      if (column.type === 'integer') {
        const parsed = Number(value);
        if (!isNaN(parsed) && Number.isSafeInteger(parsed)) {
          result[column.name] = parsed;
        }
      } else if (column.type === 'real') {
        const parsed = Number(value);
        if (!isNaN(parsed) && isFinite(parsed)) {
          result[column.name] = parsed;
        }
      }
    }
  }
  
  return result;
}

/**
 * Validate create input against model schema
 */
export function validateCreateInput(
  model: ModelProps,
  data: Record<string, unknown>
): FieldError[] {
  const errors: FieldError[] = [];
  
  // Check for unknown fields
  const validColumns = model.columns.map((c) => c.name);
  const inputFields = Object.keys(data);

  for (const field of inputFields) {
    if ((SYSTEM_COLUMNS as readonly string[]).includes(field)) {
      errors.push({
        field,
        message: `Cannot set system-managed field '${field}'`,
      });
    } else if (!validColumns.includes(field)) {
      errors.push({
        field,
        message: `Unknown field '${field}'`,
      });
    }
  }

  // Check required fields
  for (const column of model.columns) {
    // Skip system columns
    if ((SYSTEM_COLUMNS as readonly string[]).includes(column.name)) continue;
    
    // Skip primary key (usually auto-generated)
    if (column.isPrimary) continue;
    
    // Check if required but missing
    const isRequired = !column.isNullable && column.defaultValue === undefined;
    if (isRequired && !(column.name in data)) {
      errors.push({
        field: column.name,
        message: `Required field '${column.name}' is missing`,
      });
    }
  }
  
  // Type validation
  for (const column of model.columns) {
    if ((SYSTEM_COLUMNS as readonly string[]).includes(column.name)) continue;
    if (!(column.name in data)) continue;

    const value = data[column.name];

    // Allow null for nullable columns
    if (value === null && column.isNullable) continue;

    // Type-specific validation
    const typeError = validateColumnType(column, value);
    if (typeError) {
      errors.push({
        field: column.name,
        message: typeError,
      });
    }
  }

  return errors;
}

/**
 * Validate update input against model schema
 */
export function validateUpdateInput(
  model: ModelProps,
  data: Record<string, unknown>
): FieldError[] {
  const errors: FieldError[] = [];

  // Check for unknown fields
  const validColumns = model.columns.map((c) => c.name);
  const inputFields = Object.keys(data);

  for (const field of inputFields) {
    if ((SYSTEM_COLUMNS as readonly string[]).includes(field)) {
      errors.push({
        field,
        message: `Cannot update system-managed field '${field}'`,
      });
    } else if (!validColumns.includes(field)) {
      errors.push({
        field,
        message: `Unknown field '${field}'`,
      });
    }
  }

  // Type validation for provided fields
  for (const column of model.columns) {
    if ((SYSTEM_COLUMNS as readonly string[]).includes(column.name)) continue;
    if (!(column.name in data)) continue;
    
    const value = data[column.name];
    
    // Allow null for nullable columns
    if (value === null && column.isNullable) continue;
    
    // Type-specific validation
    const typeError = validateColumnType(column, value);
    if (typeError) {
      errors.push({
        field: column.name,
        message: typeError,
      });
    }
  }
  
  return errors;
}

/**
 * Validate a single column value type
 */
function validateColumnType(column: ColumnProps, value: unknown): string | null {
  if (value === undefined) return null;

  // Explicit null check — produces a clear message instead of confusing "got object"
  if (value === null) {
    return `Field '${column.name}' cannot be null`;
  }

  switch (column.type) {
    case 'text':
      if (typeof value !== 'string') {
        return `Expected string for '${column.name}', got ${typeof value}`;
      }
      // Empty strings are valid TEXT values in SQLite (NOT NULL permits '').
      // SettingsScaffold auto-create sends '' for required text fields with
      // no default — rejecting that causes 400 on first page load.
      break;

    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return `Expected safe integer for '${column.name}', got ${typeof value === 'number' ? String(value) : typeof value}`;
      }
      break;

    case 'real':
      if (typeof value !== 'number' || !isFinite(value)) {
        return `Expected finite number for '${column.name}', got ${typeof value === 'number' ? String(value) : typeof value}`;
      }
      break;

    case 'blob':
      if (typeof value !== 'string') {
        return `Expected base64 string for '${column.name}', got ${typeof value}`;
      }
      break;

    case 'json':
      // JSON accepts any value
      break;
  }

  return null;
}

/**
 * Build Zod schema from handler inputs
 */
export function buildHandlerInputSchema(inputs: InputProps[] | undefined | null): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  if (!inputs || !Array.isArray(inputs)) return z.object(shape);

  for (const input of inputs) {
    let schema: z.ZodTypeAny;
    
    switch (input.type) {
      case 'string':
        schema = z.string();
        break;
      case 'number':
        schema = z.coerce.number();
        break;
      case 'boolean':
        schema = z.coerce.boolean();
        break;
      case 'json':
        schema = z.unknown();
        break;
      default:
        schema = z.unknown();
    }
    
    // Inputs are required by default — only optional when explicitly marked
    if (input.required === false) {
      schema = schema.optional();
    }
    
    shape[input.name] = schema;
  }
  
  return z.object(shape).strict();
}

/**
 * Validate handler input
 */
export function validateHandlerInput(
  handler: HandlerProps,
  params: Record<string, unknown>
): FieldError[] {
  const errors: FieldError[] = [];

  const schema = buildHandlerInputSchema(handler.inputs);
  const result = schema.safeParse(params);
  
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        field: issue.path.join('.'),
        message: issue.message,
      });
    }
  }

  return errors;
}

/**
 * Attempt to auto-wrap flat params into handler's expected structure.
 *
 * When a handler declares exactly one required json-typed input and the
 * incoming params don't contain that key but have other fields, wrap all
 * params under that key name. This fixes the common form-to-handler
 * mismatch where forms submit flat data but handlers expect wrapped data.
 *
 * Returns the wrapped params if the heuristic matches, or null if not applicable.
 */
export function tryAutoWrapParams(
  handler: HandlerProps,
  params: Record<string, unknown>
): Record<string, unknown> | null {
  // Only applies when there are params to wrap
  if (Object.keys(params).length === 0) return null;

  // Find required json inputs
  const requiredJsonInputs = handler.inputs.filter(
    (i) => i.type === 'json' && i.required !== false
  );

  // Only auto-wrap when there's exactly one required json input
  if (requiredJsonInputs.length !== 1) return null;

  const target = requiredJsonInputs[0];

  // Don't wrap if params already has the expected key
  if (target.name in params) return null;

  // Validate the wrapped version
  const wrapped = { [target.name]: params };
  const errors = validateHandlerInput(handler, wrapped);
  return errors.length === 0 ? wrapped : null;
}
