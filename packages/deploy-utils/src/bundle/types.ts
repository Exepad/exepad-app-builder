/**
 * Bundle builder types
 */

import type {
  ModelProps,
  HandlerProps,
  InjectedProps,
} from '@exepad/types';

// Re-export canonical types
export type { ModelProps, HandlerProps };

/** @deprecated Use `InjectedProps` from `@exepad/types` */
export type InjectedAppConfig = InjectedProps;

/**
 * Handler definition from repo.backend.handlers.
 * Mirrors CustomMethodProps from @exepad/types.
 */
export interface HandlerMethod {
  source: string;
  compiled: string;
  type: 'handler' | 'task' | 'realtime' | 'source' | 'pipeline';
  summary?: string;
}

