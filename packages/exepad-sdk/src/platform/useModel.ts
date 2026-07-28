import { getPlatform } from '../helpers/bridge';
import type { UseModelOptions, UseModelReturn } from './types';

const noop = () => {};

/**
 * Per-app model catalogue. Apps augment this interface via a generated
 * `app.d.ts` that declares each model's row shape:
 *
 *     declare module '@exepad/sdk' {
 *       interface AppModels {
 *         users: { id: string; email: string; name: string };
 *       }
 *     }
 *
 * SDK-only consumers (no augmentation) get the legacy permissive
 * behaviour — `name` accepts any string and `data` is typed as
 * `Record<string, unknown>[]`. Apps that augment AppModels narrow both:
 * `useModel('unknown')` becomes a TS error and `data` carries the
 * declared row shape.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AppModels {}

type AppModelKey = keyof AppModels extends never ? string : keyof AppModels;
type AppModelData<K extends string> = K extends keyof AppModels
  ? AppModels[K]
  : Record<string, unknown>;

export function useModel<
  K extends AppModelKey,
  T = AppModelData<K & string>,
>(
  name: K,
  opts?: UseModelOptions
): UseModelReturn<T> {
  const platform = getPlatform();
  if (platform) {
    return platform.useModel<T>(name as string, opts);
  }
  // Fallback returns [] instead of null to prevent null.map() crashes in
  // components that don't guard against null.  The platform implementation
  // may still return null during loading — components should still use
  // (data ?? []) for full safety.
  return {
    data: [] as T[],
    loading: false,
    error: null,
    totalCount: 0,
    refetch: noop,
    create: async () => ({} as T),
    update: async () => ({} as T),
    remove: async () => {},
  };
}
