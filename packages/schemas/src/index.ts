/**
 * @exepad/schemas - JSON Schema validation for Exepad Platform
 *
 * This package provides:
 * - JSON schemas for WebApp configuration
 * - Validation utilities using Ajv
 * - Shared schema data (icons, fonts, full_schema, agent_docs, examples, themes)
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the shared schema data directory (packages/schemas/data/). */
export const DATA_DIR = resolve(__dirname, '..', 'data');

export {
  createValidator,
  validateWebApp,
  validateBackendProps,
  backendPropsSchema,
} from './validator.js';
export type { ValidationResult, ValidationError } from './validator.js';
