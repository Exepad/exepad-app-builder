/**
 * useHandlerData Hook
 * 
 * Calls a backend handler and returns its result.
 * Uses the API endpoint: POST /api/{appId}/{handlerName}
 */


import { useState, useEffect, useCallback } from 'react';
import { useAppConfigOptional } from '@/context/AppConfigContext';
import { dedupedFetch, invalidateDedup } from '@/lib/fetchDedup';
import { fetchWithPreviewRetry } from '@/lib/previewRetry';
import { isDynamicBackend } from '@/app_runtime/interfaces/backend';

/**
 * Normalize a handler result so frontend code can read its primary payload
 * consistently. The agent's handler planner sometimes names the output field
 * literally `.output` (a leading dot), so a handler returns `{ ".output": data }`
 * and components must read `data[".output"]`. Components frequently slip and
 * read `data.output` instead (a property that doesn't exist) — silently getting
 * `undefined`. Mirror a leading-dot `.output` key onto a plain `output` key so
 * BOTH `data.output` and `data[".output"]` resolve, without breaking either.
 */
function normalizeHandlerResult(data: unknown): unknown {
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    '.output' in (data as Record<string, unknown>) &&
    !('output' in (data as Record<string, unknown>))
  ) {
    return { ...(data as Record<string, unknown>), output: (data as Record<string, unknown>)['.output'] };
  }
  return data;
}

export interface UseHandlerDataResult<T = unknown> {
  /** The handler result data */
  data: T | null;
  /** Whether the handler is currently executing */
  loading: boolean;
  /** Error message if handler call failed */
  error: string | null;
  /** Function to trigger a re-execution */
  refetch: () => void;
}

/**
 * Hook to call a backend handler and get its result
 * 
 * @param handlerName - The handler name (e.g., "getStats")
 * @param params - Optional parameters to pass to the handler
 * @returns UseHandlerDataResult with data, loading state, error, and refetch function
 * 
 * @example
 * ```tsx
 * // Call a handler with no params
 * const { data, loading, error } = useHandlerData('getStats');
 * 
 * // Call a handler with params
 * const { data } = useHandlerData('calculateTotals', {
 *   startDate: '2024-01-01',
 *   endDate: '2024-12-31'
 * });
 * ```
 */
export function useHandlerData<T = unknown>(
  handlerName: string | undefined,
  params?: Record<string, unknown>
): UseHandlerDataResult<T> {
  const appConfigContext = useAppConfigOptional();
  const appId = appConfigContext?.apiAppId ?? appConfigContext?.appId;
  const mode = appConfigContext?.mode;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  // Auto-refetch when handler data is invalidated (e.g., after mutations)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.handlerName || detail.handlerName === handlerName) {
        invalidateDedup(`handler:${appId}:${handlerName}`);
        refetch();
      }
    };
    window.addEventListener('exepad:handler:changed', handler);
    return () => window.removeEventListener('exepad:handler:changed', handler);
  }, [appId, handlerName, refetch]);

  // Handlers commonly read from models (e.g. a `getPinnedNotes` handler over the
  // `notes` table). A model mutation (create/update/delete dispatches
  // `exepad:model:changed`) can change a handler's result, but handlers don't
  // declare their model dependencies — so refetch on ANY model change. Mutations
  // are user-initiated and handler reads are cheap, so the extra fetch is
  // acceptable, and it fixes stale handler-backed views (e.g. a sidebar "Pinned"
  // list) that previously only refreshed on a full page reload.
  useEffect(() => {
    if (!handlerName || !appId) return;
    const onModelChanged = () => {
      invalidateDedup(`handler:${appId}:${handlerName}`);
      refetch();
    };
    window.addEventListener('exepad:model:changed', onModelChanged);
    return () => window.removeEventListener('exepad:model:changed', onModelChanged);
  }, [appId, handlerName, refetch]);

  // Serialize params for dependency tracking
  const paramsKey = params ? JSON.stringify(params) : '';

  // Check if this is a frontend-only example (no backend to call)
  const routeType = appConfigContext?.routeType;
  const backend = appConfigContext?.appConfig?.backend;
  const hasBackend = isDynamicBackend(backend) && (
    (backend.handlers?.length ?? 0) > 0 || (backend.models?.length ?? 0) > 0
  );

  useEffect(() => {
    // Skip if no handler name or app ID
    if (!handlerName || !appId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Frontend-only example: no backend to call, return empty
    if (routeType === 'example' && !hasBackend) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const dedupKey = `handler:${appId}:${handlerName}:${paramsKey}`;
        const result = await dedupedFetch(dedupKey, () =>
          fetchWithPreviewRetry(async () => {
            const response = await fetch(`/api/${appId}/${handlerName}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(params || {})
            });
            return response.json();
          }, mode === 'preview'),
        );

        if (result.success) {
          setData(normalizeHandlerResult(result.data) as T);
          setError(null);
        } else {
          setData(null);
          setError(result.error?.message || 'Handler call failed');
        }
      } catch (err) {
        setData(null);
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [appId, handlerName, paramsKey, refetchTrigger, routeType, hasBackend, mode]);

  return { data, loading, error, refetch };
}

export default useHandlerData;
