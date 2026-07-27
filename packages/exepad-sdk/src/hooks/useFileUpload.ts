/**
 * useFileUpload — SDK hook for uploading files to the Exepad file storage backend.
 *
 * Self-contained version for SDK/CodeComponent consumers.
 * Uses XMLHttpRequest for upload progress tracking (fetch does not support
 * upload progress events). Auth is handled automatically by the API gateway.
 */

import { useState, useRef, useCallback, useMemo } from 'react';

// ── Types ────────────────────────────────────────────────────────────

export interface UseFileUploadOptions {
  /** App ID. If omitted, auto-extracted from URL. */
  appId?: string;
  visibility?: 'private' | 'shared' | 'public';
  modelName?: string;
  recordId?: string;
  fieldName?: string;
}

export interface FileUploadResult {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  visibility: string;
  createdAt: string;
}

export interface UseFileUploadReturn {
  /** Upload a single file. Resolves with file metadata on success. */
  upload: (file: File) => Promise<FileUploadResult>;
  /** Current upload progress (0–100). Resets to 0 between uploads. */
  progress: number;
  /** True while an upload is in flight. */
  isUploading: boolean;
  /** Error message from the last failed upload, or null. */
  error: string | null;
  /** Abort the current upload. No-op if not uploading. */
  cancel: () => void;
}

// ── Utilities ────────────────────────────────────────────────────────

/**
 * Extract the appId from the current page URL.
 * Matches: /example/{appId}/..., /a/{appId}/..., /demo/{appId}/...
 */
export function extractAppIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/\/(?:example|a|demo)\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Build a file serving URL.
 */
export function buildFileUrl(appId: string, fileId: string, filename?: string): string {
  const safeName = filename || 'file';
  return `/api/${appId}/_files/${fileId}/${encodeURIComponent(safeName)}`;
}

/**
 * React hook that memoizes a file serving URL.
 */
export function useFileUrl(appId: string, fileId: string, filename?: string): string {
  return useMemo(
    () => buildFileUrl(appId, fileId, filename),
    [appId, fileId, filename]
  );
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  const resolvedAppId = options.appId || extractAppIdFromUrl() || 'app';
  const { visibility, modelName, recordId, fieldName } = options;

  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const cancel = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
  }, []);

  const upload = useCallback(
    (file: File): Promise<FileUploadResult> => {
      return new Promise((resolve, reject) => {
        setProgress(0);
        setIsUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);
        if (visibility) formData.append('visibility', visibility);
        if (modelName) formData.append('model_name', modelName);
        if (recordId) formData.append('record_id', recordId);
        if (fieldName) formData.append('field_name', fieldName);

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          xhrRef.current = null;
          setIsUploading(false);

          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              if (response.success && response.data) {
                setProgress(100);
                resolve(response.data as FileUploadResult);
              } else {
                const msg = response.error?.message || response.error || 'Upload failed';
                setError(msg);
                reject(new Error(msg));
              }
            } catch {
              setError('Invalid response from server');
              reject(new Error('Invalid response from server'));
            }
          } else {
            let msg = `Upload failed (${xhr.status})`;
            try {
              const body = JSON.parse(xhr.responseText);
              msg = body.error?.message || body.error || msg;
            } catch { /* use default message */ }
            setError(msg);
            reject(new Error(msg));
          }
        });

        xhr.addEventListener('error', () => {
          xhrRef.current = null;
          setIsUploading(false);
          const msg = 'Network error during upload';
          setError(msg);
          reject(new Error(msg));
        });

        xhr.addEventListener('abort', () => {
          xhrRef.current = null;
          setIsUploading(false);
          setProgress(0);
          const msg = 'Upload cancelled';
          setError(msg);
          reject(new Error(msg));
        });

        xhr.open('POST', `/api/${resolvedAppId}/_files/upload`);
        xhr.send(formData);
      });
    },
    [resolvedAppId, visibility, modelName, recordId, fieldName]
  );

  return { upload, progress, isUploading, error, cancel };
}
