/**
 * Per-request metric emission.
 *
 * Entirely opt-in through the `ANALYTICS` binding: with no binding every call
 * is a no-op. The self-hosted runtime never binds it (see
 * `apps/runtime/worker/src/server/build-user-env.ts`), so this path is inert in
 * the shipped container — it is kept as the single seam a metrics sink could be
 * attached to. The write shape matches the `writeDataPoint(blobs/doubles/
 * indexes)` interface.
 */

export interface MetricEvent {
  /** RPC method or handler name (e.g. 'sys_create', 'getDashboardStats') */
  operation: string;
  /** Model name, if applicable */
  model?: string;
  /** Duration in milliseconds */
  duration: number;
  /** Whether the operation succeeded */
  success: boolean;
  /** User ID, if available */
  userId?: string;
  /** HTTP status code */
  statusCode?: number;
}

/**
 * Write a metric event to the configured sink.
 *
 * Fire-and-forget — never throws, graceful no-op when nothing is bound.
 *
 * Data layout:
 * - blobs[0]: operation
 * - blobs[1]: model (or empty)
 * - blobs[2]: userId (or empty)
 * - blobs[3]: 'ok' | 'error'
 * - doubles[0]: duration (ms)
 * - doubles[1]: statusCode
 * - indexes[0]: operation (for efficient filtering)
 */
export function writeMetric(
  ae: AnalyticsEngineDataset | undefined,
  event: MetricEvent
): void {
  if (!ae) return;

  try {
    ae.writeDataPoint({
      blobs: [
        event.operation,
        event.model ?? '',
        event.userId ?? '',
        event.success ? 'ok' : 'error',
      ],
      doubles: [event.duration, event.statusCode ?? 0],
      indexes: [event.operation],
    });
  } catch {
    // Never let analytics failures affect request handling
  }
}
