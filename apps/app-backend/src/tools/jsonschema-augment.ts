/**
 * Local declaration merge for the shared JSONSchema type.
 *
 * The CRUD/handler tool mappers (model-mapper.ts, handler-mapper.ts) emit
 * `additionalProperties: false` on generated JSON Schemas to keep MCP tool
 * inputs strict. The canonical `JSONSchema` interface in `@exepad/types`
 * does not declare that field, so we augment it here (within this package
 * only) rather than mutating the shared contract.
 */

import '@exepad/types';

declare module '@exepad/types' {
  interface JSONSchema {
    additionalProperties?: boolean;
  }
}
