/**
 * @exepad/types - Type definitions for the Exepad Platform
 *
 * This package provides TypeScript interfaces for:
 * - Config types (repo, backend config union, secrets)
 * - Backend types (models, handlers, CRUD, auth, injected config)
 * - Deploy contract types (deploy request/response, deployment status)
 *
 * NOTE: Frontend types (pages, state, theme, components) live exclusively
 * in the runtime package (apps/runtime/src/app_runtime/interfaces/).
 */

// Config types (repo, backend config union, secrets)
export * from './config';

// Backend types (canonical source for model, handler, CRUD types)
export * from './backend';

// Deploy contract types
export * from './deploy';

// Tool layer types
export * from './tools';
