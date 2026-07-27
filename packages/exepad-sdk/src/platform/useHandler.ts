import { getPlatform } from '../helpers/bridge';
import type { UseHandlerOptions, UseHandlerReturn } from './types';

const noop = () => {};

/**
 * Per-app handler-output catalogue. Apps augment this interface via a
 * generated `app.d.ts` that declares each handler's return shape:
 *
 *     declare module '@exepad/sdk' {
 *       interface AppHandlerOutputs {
 *         monthly_revenue: { month: string; total: number }[];
 *         send_invite: { ok: boolean };
 *       }
 *     }
 *
 * SDK-only consumers (no augmentation) keep the permissive
 * `name: string`, `data: T = unknown` shape. Apps that augment
 * AppHandlerOutputs narrow both: `useHandler('unknown')` becomes a TS
 * error and `data` carries the declared output shape.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AppHandlerOutputs {}

type AppHandlerName = keyof AppHandlerOutputs extends never
  ? string
  : keyof AppHandlerOutputs;
type AppHandlerData<K extends string> = K extends keyof AppHandlerOutputs
  ? AppHandlerOutputs[K]
  : unknown;

export function useHandler<
  K extends AppHandlerName,
  T = AppHandlerData<K & string>,
>(
  name: K,
  opts?: UseHandlerOptions
): UseHandlerReturn<T> {
  const platform = getPlatform();
  if (platform) {
    return platform.useHandler<T>(name as string, opts);
  }
  return {
    data: null,
    loading: false,
    error: null,
    execute: async () => null,
    refetch: noop,
  };
}
