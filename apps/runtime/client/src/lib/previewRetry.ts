/**
 * Preview-mode retry for API fetches.
 *
 * When the preview deploy hasn't completed yet, the gateway returns
 * 503 DEPLOY_IN_PROGRESS. This wrapper retries with exponential backoff
 * so preview users see data appear automatically once deploy finishes.
 *
 * Only retries in preview mode; published-mode calls pass through unchanged.
 */

const MAX_RETRIES = 4;
const INITIAL_DELAY_MS = 2_000; // 2s, 4s, 8s, 16s → 30s total window
const RETRYABLE_CODES = new Set(['DEPLOY_IN_PROGRESS', 'APP_NOT_FOUND']);

export async function fetchWithPreviewRetry<T>(
  fetchFn: () => Promise<T>,
  isPreview: boolean,
): Promise<T> {
  if (!isPreview) return fetchFn();

  let lastResult!: T;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, INITIAL_DELAY_MS * 2 ** (attempt - 1)));
    }
    lastResult = await fetchFn();

    // Success or non-retryable error — stop immediately
    const res = lastResult as Record<string, unknown>;
    if (res?.success !== false) return lastResult;
    const code = (res?.error as Record<string, unknown>)?.code;
    if (!RETRYABLE_CODES.has(code as string)) return lastResult;

    console.log(`[Preview Retry] Attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${code}`);
  }

  return lastResult;
}
