/**
 * useModelData Hook
 * 
 * Fetches data from a backend model via CRUD API.
 * Uses the RPC endpoint: POST /api/{appId}/{modelName}
 * with method: sys_list
 * 
 * Also syncs data to app state store for computed properties to access.
 */


import { useState, useEffect, useCallback } from 'react';
import { useAppConfigOptional } from '@/context/AppConfigContext';
import { useAppStateStore } from '@/stores/appStateStore';
import { dedupedFetch, invalidateDedup } from '@/lib/fetchDedup';
import { fetchWithPreviewRetry } from '@/lib/previewRetry';
import { isDynamicBackend } from '@/app_runtime/interfaces/backend';

export interface ModelDataParams {
  /** Filter conditions for the query */
  filters?: Record<string, unknown>;
  /** Sort order: { fieldName: 'asc' | 'desc' } — supports multi-column */
  orderBy?: Record<string, 'asc' | 'desc'>;
  /** Maximum number of records to return */
  limit?: number;
  /** Number of records to skip */
  offset?: number;
  /** Server-side aggregation (e.g., { fn: 'sum', of: 'total' }) */
  aggregate?: { fn: string; of: string };
  /** Full-text search query string */
  search?: string;
  /** Columns to search across when `search` is provided */
  searchFields?: string[];
}

export interface UseModelDataResult<T = Record<string, any>> {
  /** The fetched data records */
  data: T[] | null;
  /** Whether data is currently loading */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Total count of records (for pagination) */
  totalCount: number;
  /** Function to trigger a refetch */
  refetch: () => void;
}

/**
 * Hook to fetch data from a backend model via CRUD API
 * 
 * @param modelName - The model name (e.g., "contacts")
 * @param params - Optional query parameters (filters, orderBy, limit, offset)
 * @returns UseModelDataResult with data, loading state, error, and refetch function
 * 
 * @example
 * ```tsx
 * // Fetch all contacts
 * const { data, loading, error } = useModelData('contacts');
 * 
 * // Fetch with filters and pagination
 * const { data } = useModelData('tasks', {
 *   filters: { status: 'active' },
 *   orderBy: { createdAt: 'desc' },
 *   limit: 20,
 *   offset: 0
 * });
 * ```
 */
export function useModelData<T = Record<string, any>>(
  modelName: string | undefined,
  params?: ModelDataParams
): UseModelDataResult<T> {
  const appConfigContext = useAppConfigOptional();
  const appId = appConfigContext?.apiAppId ?? appConfigContext?.appId;
  const mode = appConfigContext?.mode;

  // Note: We use useAppStateStore.getState().set inside the effect callback
  // instead of a selector to avoid re-triggering the effect on every store mutation.

  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  // Auto-refetch when model data is mutated elsewhere (create/update/delete)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.modelName === modelName) {
        // Clear cached responses so the next fetch gets fresh data
        invalidateDedup(`model:${appId}:${modelName}`);
        refetch();
      }
    };
    window.addEventListener('exepad:model:changed', handler);
    return () => window.removeEventListener('exepad:model:changed', handler);
  }, [appId, modelName, refetch]);

  // Serialize params to a stable string to avoid infinite re-fetch loops.
  // Object references (filters, orderBy) change on every parent re-render
  // (e.g., after storeSet updates the Zustand store), so we compare by value.
  const paramsKey = JSON.stringify({
    filters: params?.filters,
    orderBy: params?.orderBy,
    limit: params?.limit,
    offset: params?.offset,
    aggregate: params?.aggregate,
    search: params?.search,
    searchFields: params?.searchFields,
  });

  // Check if this is a frontend-only example (no backend to call)
  const routeType = appConfigContext?.routeType;
  const backend = appConfigContext?.appConfig?.backend;
  const hasBackend = isDynamicBackend(backend) && (backend.models?.length ?? 0) > 0;

  useEffect(() => {
    // Skip if no model name or app ID
    if (!modelName || !appId) {
      setData(null);
      setLoading(false);
      setError(null);
      setTotalCount(0);
      return;
    }

    // Frontend-only example: no backend to call, return empty data
    if (routeType === 'example' && !hasBackend) {
      setData([]);
      setLoading(false);
      setError(null);
      setTotalCount(0);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const parsedParams = JSON.parse(paramsKey);
        const dedupKey = `model:${appId}:${modelName}:${paramsKey}`;
        const result = await dedupedFetch(dedupKey, () =>
          fetchWithPreviewRetry(async () => {
            const response = await fetch(`/api/${appId}/${modelName}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                method: parsedParams.aggregate ? 'sys_aggregate' : 'sys_list',
                model: modelName,
                params: {
                  filters: parsedParams.filters,
                  orderBy: parsedParams.orderBy,
                  limit: parsedParams.limit ?? 100,
                  offset: parsedParams.offset ?? 0,
                  ...(parsedParams.aggregate && { aggregate: parsedParams.aggregate }),
                  ...(parsedParams.search && { search: parsedParams.search }),
                  ...(parsedParams.searchFields && { searchFields: parsedParams.searchFields }),
                }
              })
            });
            return response.json();
          }, mode === 'preview'),
        );

        if (result.success) {
          const fetchedData = result.data || [];
          setData(fetchedData);
          setTotalCount(result.pagination?.total ?? fetchedData.length ?? 0);
          setError(null);

          // Sync to app state store for computed properties
          useAppStateStore.getState().set(modelName, fetchedData);
        } else {
          setData(null);
          setError(result.error?.message || 'Failed to fetch model data');
        }
      } catch (err) {
        setData(null);
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [appId, modelName, paramsKey, refetchTrigger, routeType, hasBackend, mode]);

  return { data, loading, error, totalCount, refetch };
}

export default useModelData;

