import { useModel } from './useModel';

/**
 * Return shape for {@link useCount}.
 *
 * `count` is a plain number — no `(data as any) ?? 0` casts, no array
 * wrappers. `loading` and `error` mirror the underlying useModel call
 * so the consumer can render a skeleton or error state in the usual
 * way.
 */
export interface UseCountReturn {
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Get the row count of a backend model.
 *
 * Convenience wrapper over {@link useModel} for the "I just want a
 * number" case. Under the hood it issues a `sys_list` with `limit: 1`
 * and surfaces the runtime's `pagination.total` as `count`.
 *
 * Replaces the boilerplate-y pattern:
 *
 * ```tsx
 * const { data: orders } = useModel('orders', { aggregate: { fn: 'count', of: '*' } });
 * const orderCount = (orders as any) ?? 0;  // ← ugly cast, wrong type
 * ```
 *
 * with:
 *
 * ```tsx
 * const { count: orderCount } = useCount('orders');
 * ```
 *
 * Bug class motivation: app eiu7xj0v (2026-05-14) had
 * `SettingsContent` rendering `{(orders as any) ?? 0}` to display
 * record counts on its Integration Summary panel. The cast hid the
 * fact that `useModel` returns an array, not a number — the panel
 * silently showed `[object Object]` (or `0` on falsy paths) instead
 * of the real count.
 *
 * Honours per-app `AppModels` augmentation: `useCount('unknown')`
 * becomes a TS error if the app's `app.d.ts` declares a closed model
 * catalogue.
 */
export function useCount<K extends string>(name: K): UseCountReturn {
  // `limit: 1` — we don't need the rows, only `totalCount`. Keeping
  // limit > 0 (instead of 0) avoids edge cases in user-workers that
  // treat 0 as "unlimited" or "use default".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { totalCount, loading, error, refetch } = useModel(name as any, {
    limit: 1,
  });
  return {
    count: totalCount ?? 0,
    loading,
    error,
    refetch,
  };
}
