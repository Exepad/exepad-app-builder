/**
 * Gateway — Shared types and constants
 */

import type { BackendProps, SecurityProps } from '@exepad/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BridgePayload {
  uid: number;
  email: string;
  type: string;
  exp: number;
}

export interface AppConfig {
  backend?: BackendProps;
  security?: SecurityProps;
  services?: Record<string, { enabled?: boolean } & Record<string, unknown>>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const CONFIG_CACHE_TTL = 60_000;
export const NULL_CONFIG_CACHE_TTL = 10_000;
