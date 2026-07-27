/**
 * R2 key builder and path traversal guard
 *
 * R2 key format: {ownerId}/{fileId}/{sanitizedFilename}
 * All components are server-generated — the client never provides R2 keys.
 * Each app has its own R2 bucket (WfP resource isolation), so appId is not in the key.
 */

import { sanitizeFilename } from './validation';

/**
 * Assert that no component contains path traversal sequences.
 * Throws if any component is unsafe.
 */
export function assertNoPathTraversal(...components: string[]): void {
  for (const component of components) {
    if (
      component.includes('..') ||
      component.includes('/') ||
      component.includes('\\') ||
      component.includes('\0')
    ) {
      throw new Error(`Path traversal detected in component: ${component}`);
    }
  }
}

/**
 * Build an R2 object key from server-controlled components.
 *
 * @param ownerId - File owner (from authenticated user context)
 * @param fileId - UUID v4 (server-generated via crypto.randomUUID())
 * @param filename - Original filename (will be sanitized)
 * @returns R2 key in format: {ownerId}/{fileId}/{sanitizedFilename}
 */
export function buildR2Key(
  ownerId: string,
  fileId: string,
  filename: string,
): string {
  const safeName = sanitizeFilename(filename);
  assertNoPathTraversal(ownerId, fileId, safeName);
  return `${ownerId}/${fileId}/${safeName}`;
}

/**
 * Build the public-facing file URL path for a given file.
 */
export function buildFileUrl(appId: string, fileId: string, filename: string): string {
  const safeName = encodeURIComponent(sanitizeFilename(filename));
  return `/api/${appId}/_files/${fileId}/${safeName}`;
}
