/**
 * File storage module
 *
 * Provides file upload, serve, and metadata operations backed by R2 + D1.
 */

export { handleFileUpload } from './upload';
export { handleFileServe } from './serve';
export { sysFileRead, sysFileList, sysFileDelete } from './read';
export { checkFileAccess, type FileRecord } from './access';
export { checkUploadQuota, type QuotaCheckResult } from './quota';
export { buildR2Key, buildFileUrl, assertNoPathTraversal } from './keys';
export {
  validateMimeType,
  verifyMagicBytes,
  sanitizeFilename,
  sanitizeSvg,
  getContentDisposition,
  MIME_BLOCKLIST,
  SAFE_INLINE_TYPES,
} from './validation';
