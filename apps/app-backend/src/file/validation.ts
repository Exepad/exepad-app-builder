/**
 * File validation utilities
 *
 * MIME type checking, magic byte verification, and filename sanitization.
 */

/** MIME types that are always blocked regardless of config */
export const MIME_BLOCKLIST = new Set([
  'application/x-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-bat',
  'application/x-msi',
  'application/x-dosexec',
  'application/vnd.microsoft.portable-executable',
  'text/html',
  'text/javascript',
  'application/javascript',
  'application/xhtml+xml',
]);

/** MIME types that can be served inline (Content-Disposition: inline) */
export const SAFE_INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
]);

/**
 * Canonicalize a MIME type for comparison: lowercase, strip parameters
 * (`;charset=…`), and trim. Every MIME check (blocklist, allowlist, magic-byte
 * verification, inline-vs-attachment disposition) MUST use this so a client
 * cannot slip a type past one check via casing/params while another check
 * lowercases it — the exact gap that let `IMAGE/PNG` skip magic-byte
 * verification yet serve inline.
 */
export function normalizeMimeType(contentType: string): string {
  return contentType.toLowerCase().split(';')[0].trim();
}

/**
 * Magic byte signatures for common file types.
 * Each entry maps a MIME prefix or type to expected starting bytes.
 */
interface MagicSignature {
  mime: string;
  bytes: number[];
  offset?: number;
  /** Extra fixed markers that must ALL match (e.g. WEBP's 'WEBP' at offset 8). */
  also?: Array<{ bytes: number[]; offset: number }>;
  /**
   * For ISO-BMFF ('ftyp') containers: the 4-char major brand at offset 8 must
   * be one of these. Distinguishes avif/heic/mp4 which otherwise share the same
   * generic 'ftyp' marker, so an mp4 can't masquerade as an inline-served avif.
   */
  brands?: string[];
}

const MAGIC_BYTES: MagicSignature[] = [
  // Images
  { mime: 'image/jpeg',  bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',   bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/gif',   bytes: [0x47, 0x49, 0x46, 0x38] },  // GIF8
  // RIFF header at 0 AND the 'WEBP' form marker at offset 8 — a bare RIFF
  // container (AVI/WAV) declared as image/webp must not pass.
  { mime: 'image/webp',  bytes: [0x52, 0x49, 0x46, 0x46], offset: 0,
    also: [{ bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }] }, // 'WEBP'
  // AVIF/HEIC/MP4: ISO BMFF containers have 'ftyp' (0x66747970) at offset 4,
  // disambiguated by the major brand at offset 8.
  { mime: 'image/avif',  bytes: [0x66, 0x74, 0x79, 0x70], offset: 4,
    brands: ['avif', 'avis', 'mif1', 'miaf', 'ma1a', 'ma1b'] },
  { mime: 'image/heic',  bytes: [0x66, 0x74, 0x79, 0x70], offset: 4,
    brands: ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'] },

  // Documents
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF

  // Office (ZIP-based: docx, xlsx, pptx)
  { mime: 'application/vnd.openxmlformats', bytes: [0x50, 0x4B, 0x03, 0x04] }, // PK..
  { mime: 'application/zip', bytes: [0x50, 0x4B, 0x03, 0x04] },

  // Media
  { mime: 'video/mp4',  bytes: [0x66, 0x74, 0x79, 0x70], offset: 4,
    brands: ['mp41', 'mp42', 'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'avc1', 'dash', 'mmp4', 'm4v ', 'm4a '] },
  { mime: 'audio/mpeg', bytes: [0xFF, 0xFB] },                         // MP3 sync word
  { mime: 'audio/mpeg', bytes: [0x49, 0x44, 0x33] },                   // ID3 tag
];

/** Read the 4-char ASCII ISO-BMFF major brand at offset 8 (lowercased). */
function readFtypBrand(fileBytes: Uint8Array): string | null {
  if (fileBytes.length < 12) return null;
  let brand = '';
  for (let i = 8; i < 12; i++) {
    const c = fileBytes[i];
    // Restrict to printable ASCII; anything else means this isn't a real brand.
    if (c < 0x20 || c > 0x7e) return null;
    brand += String.fromCharCode(c);
  }
  return brand.toLowerCase();
}

/**
 * Check if a file's magic bytes match its declared MIME type.
 * Returns true if the bytes are consistent OR if we don't have a signature for
 * an ATTACHMENT-served type. Returns false if the bytes contradict the declared
 * type, or if a type eligible for INLINE serving has no registered signature.
 *
 * Rationale: types outside SAFE_INLINE_TYPES are always served as
 * `Content-Disposition: attachment` with `nosniff` (see serve.ts), so an
 * unknown-signature attachment cannot be interpreted as active content by the
 * browser — allowing it keeps legitimate CSV/JSON/plain-text uploads working.
 * Inline-eligible types, however, are rendered in the browser, so they MUST have
 * a signature we can verify; a mismatch or a missing signature fails closed.
 */
export function verifyMagicBytes(declaredMime: string, fileBytes: Uint8Array): boolean {
  // Normalize exactly as serve.ts / getContentDisposition do (lowercase, drop
  // parameters, trim). Without this, a mixed-case or space-padded type
  // (`IMAGE/PNG`, ` image/png`) matches no signature AND is absent from
  // SAFE_INLINE_TYPES, so the "no signature" branch returns true and SKIPS
  // magic-byte verification — yet serve.ts lowercases the same type, finds it
  // inline-eligible, and serves the unverified bytes inline. Normalizing here
  // closes that bypass.
  const normalizedMime = normalizeMimeType(declaredMime);

  // Find matching signatures for the declared MIME type
  const matchingSignatures = MAGIC_BYTES.filter(
    (sig) => normalizedMime === sig.mime || normalizedMime.startsWith(sig.mime)
  );

  // If no signature registered for this type: fail CLOSED for inline-eligible
  // types (they're rendered by the browser and must be verifiable), otherwise
  // allow it (attachment-served, non-executable by nosniff).
  if (matchingSignatures.length === 0) return !SAFE_INLINE_TYPES.has(normalizedMime);

  // Check if at least one signature matches
  return matchingSignatures.some((sig) => {
    const offset = sig.offset ?? 0;
    if (fileBytes.length < offset + sig.bytes.length) return false;
    if (!sig.bytes.every((b, i) => fileBytes[offset + i] === b)) return false;

    // Extra fixed markers (e.g. WEBP's 'WEBP' at offset 8) must ALL match.
    if (sig.also) {
      for (const marker of sig.also) {
        if (fileBytes.length < marker.offset + marker.bytes.length) return false;
        if (!marker.bytes.every((b, i) => fileBytes[marker.offset + i] === b)) return false;
      }
    }

    // ISO-BMFF 'ftyp' types must present an allowed major brand so an mp4
    // cannot pass as an inline-served avif/heic (and vice versa).
    if (sig.brands) {
      const brand = readFtypBrand(fileBytes);
      if (!brand || !sig.brands.includes(brand)) return false;
    }

    return true;
  });
}

/**
 * Check if a MIME type matches an allow list entry (supports wildcards like 'image/*').
 */
export function mimeMatchesPattern(mime: string, pattern: string): boolean {
  if (pattern === '*/*' || pattern === '*') return true;
  if (pattern === mime) return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return mime.startsWith(prefix + '/');
  }
  return false;
}

/**
 * Validate a file's MIME type against blocklist and optional allow list.
 *
 * @returns Error message if invalid, or null if valid
 */
export function validateMimeType(
  contentType: string,
  allowedMimeTypes?: string[],
  allowSvg?: boolean,
): string | null {
  const normalizedMime = normalizeMimeType(contentType);

  // SVG check
  if (normalizedMime === 'image/svg+xml' && !allowSvg) {
    return 'SVG uploads are not allowed (enable allowSvg in storage config)';
  }

  // Blocklist check
  if (MIME_BLOCKLIST.has(normalizedMime)) {
    return `File type '${normalizedMime}' is not allowed`;
  }

  // Allowlist check (if configured)
  if (allowedMimeTypes && allowedMimeTypes.length > 0) {
    const allowed = allowedMimeTypes.some((pattern) =>
      mimeMatchesPattern(normalizedMime, pattern)
    );
    if (!allowed) {
      return `File type '${normalizedMime}' is not in the allowed types: ${allowedMimeTypes.join(', ')}`;
    }
  }

  return null;
}

/**
 * Sanitize a filename for safe storage and serving.
 *
 * - Strips path traversal sequences (../, ..\, etc.)
 * - Removes null bytes and control characters
 * - Truncates to 255 characters
 * - Falls back to 'unnamed' if nothing remains
 */
export function sanitizeFilename(name: string): string {
  let sanitized = name;

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove path separators and traversal
  sanitized = sanitized.replace(/\.\.\//g, '');
  sanitized = sanitized.replace(/\.\.\\/g, '');
  sanitized = sanitized.replace(/[/\\]/g, '');

  // Remove control characters (U+0000 to U+001F, U+007F)
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  // Replace potentially dangerous characters
  sanitized = sanitized.replace(/[<>:"|?*]/g, '_');

  // Trim leading/trailing dots and spaces
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  // Truncate to 255 characters
  if (sanitized.length > 255) {
    const ext = sanitized.lastIndexOf('.');
    if (ext > 0) {
      const extension = sanitized.slice(ext);
      sanitized = sanitized.slice(0, 255 - extension.length) + extension;
    } else {
      sanitized = sanitized.slice(0, 255);
    }
  }

  return sanitized || 'unnamed';
}

/**
 * Determine Content-Disposition for a given MIME type.
 * Safe types (images, PDFs) are served inline; everything else as attachment.
 */
export function getContentDisposition(contentType: string, filename: string): string {
  const normalizedMime = normalizeMimeType(contentType);
  const disposition = SAFE_INLINE_TYPES.has(normalizedMime) ? 'inline' : 'attachment';
  // RFC 5987 encoding for filenames with special characters
  const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape);
  return `${disposition}; filename="${encodedFilename}"`;
}

/**
 * Sanitize SVG content by removing potentially dangerous elements and attributes.
 *
 * Workers runtime does not have DOMParser, so this uses regex-based stripping.
 * This is defense-in-depth — SVGs are already gated by `allowSvg: true`.
 *
 * IMPORTANT: this regex stripper is BEST-EFFORT defense-in-depth only. It is
 * known to be incomplete against a determined bypass (namespaced/entity-encoded
 * attributes, exotic CSS). The primary control is that SVG is NEVER in
 * SAFE_INLINE_TYPES, so serve.ts always sends it as `Content-Disposition:
 * attachment` with `nosniff` + `script-src 'none'` — the browser never executes
 * it as active content. Do NOT relax that serving posture on the strength of
 * this function; if inline SVG rendering is ever required, sanitize with a
 * spec-aware parser (e.g. DOMPurify in a real DOM) instead of these regexes.
 *
 * Strips:
 * - `<script>` tags (with content)
 * - `<style>` blocks (CSS @import / url() / expression() vectors)
 * - SMIL animation elements (`<animate>`, `<set>`, `<animateTransform>`, …)
 *   that can set an `href`/attribute to a `javascript:` URL at runtime
 * - Event handler attributes (onclick, onload, onerror, etc.)
 * - `javascript:` protocol in href/xlink:href
 * - `<foreignObject>`, `<iframe>`, `<embed>`, `<object>` elements
 */
export function sanitizeSvg(svgContent: string): string {
  let sanitized = svgContent;

  // 1. Remove <script>...</script> tags (including nested, case-insensitive)
  sanitized = sanitized.replace(/<script[\s>][\s\S]*?<\/script\s*>/gi, '');
  // Also remove self-closing <script /> and unclosed <script> tags
  sanitized = sanitized.replace(/<script\b[^>]*\/?\s*>/gi, '');

  // 2. Remove dangerous elements. Beyond the classic embedding tags, strip
  //    <style> (CSS-based vectors) and SMIL animation elements, which can
  //    rewrite an attribute/href to a javascript: URL without any on* handler
  //    (e.g. <set attributeName="href" to="javascript:...">).
  const dangerousTags = [
    'foreignObject', 'iframe', 'embed', 'object', 'style',
    'animate', 'animateTransform', 'animateMotion', 'set',
  ];
  for (const tag of dangerousTags) {
    const pairRegex = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    sanitized = sanitized.replace(pairRegex, '');
    const selfRegex = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi');
    sanitized = sanitized.replace(selfRegex, '');
  }

  // 3. Remove event handler attributes (on*)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 4. Neutralize javascript: and data: protocols in href and xlink:href
  // Leading whitespace is included (\s*) because browsers strip it before
  // evaluating the protocol — href="  javascript:..." executes without it.
  sanitized = sanitized.replace(
    /(href\s*=\s*(?:"|'))\s*(?:javascript|data)\s*:/gi,
    '$1#'
  );
  sanitized = sanitized.replace(
    /(xlink:href\s*=\s*(?:"|'))\s*(?:javascript|data)\s*:/gi,
    '$1#'
  );

  return sanitized;
}
