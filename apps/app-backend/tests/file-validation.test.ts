/**
 * Tests for file validation utilities
 *
 * Covers: MIME validation, magic byte verification, filename sanitization,
 * Content-Disposition generation.
 */

import { describe, it, expect } from 'vitest';
import {
  verifyMagicBytes,
  mimeMatchesPattern,
  validateMimeType,
  sanitizeFilename,
  sanitizeSvg,
  getContentDisposition,
  MIME_BLOCKLIST,
  SAFE_INLINE_TYPES,
} from '../src/file/validation';

// ───────────────────────────────────────────────────────────────────
// verifyMagicBytes
// ───────────────────────────────────────────────────────────────────
describe('verifyMagicBytes', () => {
  it('accepts valid JPEG magic bytes', () => {
    const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
    expect(verifyMagicBytes('image/jpeg', bytes)).toBe(true);
  });

  it('rejects wrong bytes for JPEG', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG bytes
    expect(verifyMagicBytes('image/jpeg', bytes)).toBe(false);
  });

  it('accepts valid PNG magic bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
    expect(verifyMagicBytes('image/png', bytes)).toBe(true);
  });

  it('accepts valid PDF magic bytes', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]); // %PDF-
    expect(verifyMagicBytes('application/pdf', bytes)).toBe(true);
  });

  it('accepts valid GIF magic bytes', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]); // GIF89
    expect(verifyMagicBytes('image/gif', bytes)).toBe(true);
  });

  it('accepts a real WEBP (RIFF + "WEBP" marker at offset 8)', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, // RIFF + size
      0x57, 0x45, 0x42, 0x50,                          // WEBP
    ]);
    expect(verifyMagicBytes('image/webp', bytes)).toBe(true);
  });

  it('rejects a bare RIFF container (AVI/WAV) declared as inline-served WEBP', () => {
    // RIFF header present but the form marker at offset 8 is 'AVI ' — must not
    // pass as image/webp (which is served inline).
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, // RIFF + size
      0x41, 0x56, 0x49, 0x20,                          // 'AVI '
    ]);
    expect(verifyMagicBytes('image/webp', bytes)).toBe(false);
  });

  it('accepts valid AVIF magic bytes (ftyp + "avif" brand)', () => {
    // Real AVIF: 4-byte size + "ftyp" + "avif" major brand at offset 8.
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, // ....ftyp
      0x61, 0x76, 0x69, 0x66,                          // avif
    ]);
    expect(verifyMagicBytes('image/avif', bytes)).toBe(true);
  });

  it('rejects AVIF without ftyp marker', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x1C, 0x00, 0x00, 0x00, 0x00]);
    expect(verifyMagicBytes('image/avif', bytes)).toBe(false);
  });

  it('rejects an MP4 masquerading as an inline-served AVIF (brand mismatch)', () => {
    // 'ftyp' present but the major brand is a video brand ('isom'): must NOT
    // pass as image/avif, which would otherwise be served inline.
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // ....ftyp
      0x69, 0x73, 0x6F, 0x6D,                          // isom
    ]);
    expect(verifyMagicBytes('image/avif', bytes)).toBe(false);
  });

  it('accepts valid MP4 magic bytes (ftyp + "isom" brand)', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // ....ftyp
      0x69, 0x73, 0x6F, 0x6D,                          // isom
    ]);
    expect(verifyMagicBytes('video/mp4', bytes)).toBe(true);
  });

  it('accepts MP3 with sync word', () => {
    const bytes = new Uint8Array([0xFF, 0xFB, 0x90, 0x00]);
    expect(verifyMagicBytes('audio/mpeg', bytes)).toBe(true);
  });

  it('accepts MP3 with ID3 tag', () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x03]);
    expect(verifyMagicBytes('audio/mpeg', bytes)).toBe(true);
  });

  it('allows unknown ATTACHMENT-served MIME types (no signature to check)', () => {
    // These are served with Content-Disposition: attachment + nosniff, so an
    // unverifiable body cannot be interpreted as active content.
    const bytes = new Uint8Array([0x00, 0x01, 0x02]);
    expect(verifyMagicBytes('application/octet-stream', bytes)).toBe(true);
    expect(verifyMagicBytes('text/plain', bytes)).toBe(true);
    expect(verifyMagicBytes('application/json', bytes)).toBe(true);
  });

  it('rejects when file is too short for signature', () => {
    const bytes = new Uint8Array([0xFF]); // Too short for JPEG (needs 3 bytes)
    expect(verifyMagicBytes('image/jpeg', bytes)).toBe(false);
  });

  it('accepts ZIP-based Office formats', () => {
    const bytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
    expect(verifyMagicBytes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes)).toBe(true);
  });

  it('handles empty byte array', () => {
    const bytes = new Uint8Array([]);
    expect(verifyMagicBytes('image/jpeg', bytes)).toBe(false); // Has signature, too short
    expect(verifyMagicBytes('text/plain', bytes)).toBe(true);  // No signature registered
  });

  it('normalizes casing — a mixed-case inline type cannot skip verification', () => {
    // Bypass: `IMAGE/PNG` matched no (lowercase) signature AND was absent from
    // SAFE_INLINE_TYPES, so the "no signature" branch returned true and SKIPPED
    // magic-byte checks — yet serve.ts lowercases it, finds it inline-eligible,
    // and serves the unverified bytes inline. Post-fix it normalizes to
    // image/png, so non-PNG bytes are rejected and real PNG bytes pass.
    const nonPng = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const realPng = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    expect(verifyMagicBytes('IMAGE/PNG', nonPng)).toBe(false);
    expect(verifyMagicBytes('IMAGE/PNG', realPng)).toBe(true);
    expect(verifyMagicBytes('Image/Png', realPng)).toBe(true);
  });

  it('normalizes parameters and whitespace on inline types', () => {
    const nonJpeg = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const realJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
    // `;charset=…` param and leading/trailing space must not let bytes skip
    // verification for an inline-served type.
    expect(verifyMagicBytes('image/jpeg;charset=binary', nonJpeg)).toBe(false);
    expect(verifyMagicBytes('  image/jpeg  ', nonJpeg)).toBe(false);
    expect(verifyMagicBytes('image/jpeg;charset=binary', realJpeg)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────
// mimeMatchesPattern
// ───────────────────────────────────────────────────────────────────
describe('mimeMatchesPattern', () => {
  it('matches exact MIME type', () => {
    expect(mimeMatchesPattern('image/jpeg', 'image/jpeg')).toBe(true);
  });

  it('does not match different MIME type', () => {
    expect(mimeMatchesPattern('image/jpeg', 'image/png')).toBe(false);
  });

  it('matches wildcard subtype', () => {
    expect(mimeMatchesPattern('image/jpeg', 'image/*')).toBe(true);
    expect(mimeMatchesPattern('image/png', 'image/*')).toBe(true);
    expect(mimeMatchesPattern('image/webp', 'image/*')).toBe(true);
  });

  it('does not match wrong type with wildcard', () => {
    expect(mimeMatchesPattern('application/pdf', 'image/*')).toBe(false);
  });

  it('matches catch-all patterns', () => {
    expect(mimeMatchesPattern('anything/here', '*/*')).toBe(true);
    expect(mimeMatchesPattern('anything/here', '*')).toBe(true);
  });

  it('does not partially match without wildcard', () => {
    expect(mimeMatchesPattern('image/jpeg', 'image/jp')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────
// validateMimeType
// ───────────────────────────────────────────────────────────────────
describe('validateMimeType', () => {
  it('allows common safe types with no allowlist', () => {
    expect(validateMimeType('image/jpeg')).toBeNull();
    expect(validateMimeType('image/png')).toBeNull();
    expect(validateMimeType('application/pdf')).toBeNull();
    expect(validateMimeType('application/json')).toBeNull();
  });

  it('blocks MIME types in the blocklist', () => {
    expect(validateMimeType('text/html')).toMatch(/not allowed/);
    expect(validateMimeType('application/javascript')).toMatch(/not allowed/);
    expect(validateMimeType('application/x-executable')).toMatch(/not allowed/);
    expect(validateMimeType('application/x-msdownload')).toMatch(/not allowed/);
  });

  it('blocks SVG by default', () => {
    const result = validateMimeType('image/svg+xml');
    expect(result).toMatch(/SVG/);
  });

  it('allows SVG when allowSvg is true', () => {
    expect(validateMimeType('image/svg+xml', undefined, true)).toBeNull();
  });

  it('enforces allowlist when provided', () => {
    expect(validateMimeType('image/jpeg', ['image/*'])).toBeNull();
    expect(validateMimeType('application/pdf', ['image/*'])).toMatch(/not in the allowed types/);
  });

  it('normalizes MIME type with charset', () => {
    // text/plain; charset=utf-8 → text/plain
    expect(validateMimeType('text/plain; charset=utf-8')).toBeNull();
  });

  it('normalizes case', () => {
    expect(validateMimeType('IMAGE/JPEG')).toBeNull();
    expect(validateMimeType('TEXT/HTML')).toMatch(/not allowed/);
  });

  it('blocklist takes precedence over allowlist', () => {
    // Even if allowlist includes text/html, blocklist should block it
    const result = validateMimeType('text/html', ['text/*']);
    expect(result).toMatch(/not allowed/);
  });

  it('allows anything with empty allowlist', () => {
    expect(validateMimeType('custom/type', [])).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────
// sanitizeFilename
// ───────────────────────────────────────────────────────────────────
describe('sanitizeFilename', () => {
  it('passes through normal filenames', () => {
    expect(sanitizeFilename('photo.jpg')).toBe('photo.jpg');
    expect(sanitizeFilename('document.pdf')).toBe('document.pdf');
    expect(sanitizeFilename('my-file_v2.txt')).toBe('my-file_v2.txt');
  });

  it('strips path traversal sequences', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windowssystem32');
  });

  it('removes forward and back slashes', () => {
    expect(sanitizeFilename('path/to/file.txt')).toBe('pathtofile.txt');
    expect(sanitizeFilename('path\\to\\file.txt')).toBe('pathtofile.txt');
  });

  it('removes null bytes', () => {
    expect(sanitizeFilename('file\0.txt')).toBe('file.txt');
  });

  it('removes control characters', () => {
    expect(sanitizeFilename('file\x01\x02.txt')).toBe('file.txt');
    expect(sanitizeFilename('file\x7F.txt')).toBe('file.txt');
  });

  it('replaces dangerous characters with underscore', () => {
    expect(sanitizeFilename('file<>:"|?*.txt')).toBe('file_______.txt');
  });

  it('trims leading/trailing dots and spaces', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('...file.txt')).toBe('file.txt');
    expect(sanitizeFilename('file.txt...')).toBe('file.txt');
    expect(sanitizeFilename('  file.txt  ')).toBe('file.txt');
  });

  it('falls back to "unnamed" for empty result', () => {
    expect(sanitizeFilename('')).toBe('unnamed');
    expect(sanitizeFilename('...')).toBe('unnamed');
    expect(sanitizeFilename('/')).toBe('unnamed');
    expect(sanitizeFilename('\0')).toBe('unnamed');
  });

  it('truncates to 255 characters preserving extension', () => {
    const longName = 'a'.repeat(300) + '.jpg';
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result).toMatch(/\.jpg$/);
  });

  it('truncates to 255 characters without extension', () => {
    const longName = 'a'.repeat(300);
    const result = sanitizeFilename(longName);
    expect(result.length).toBe(255);
  });

  it('handles unicode filenames', () => {
    expect(sanitizeFilename('日本語ファイル.txt')).toBe('日本語ファイル.txt');
    expect(sanitizeFilename('café.pdf')).toBe('café.pdf');
  });
});

// ───────────────────────────────────────────────────────────────────
// getContentDisposition
// ───────────────────────────────────────────────────────────────────
describe('getContentDisposition', () => {
  it('returns inline for safe image types', () => {
    expect(getContentDisposition('image/jpeg', 'photo.jpg')).toMatch(/^inline;/);
    expect(getContentDisposition('image/png', 'logo.png')).toMatch(/^inline;/);
    expect(getContentDisposition('image/gif', 'anim.gif')).toMatch(/^inline;/);
    expect(getContentDisposition('image/webp', 'pic.webp')).toMatch(/^inline;/);
    expect(getContentDisposition('image/avif', 'pic.avif')).toMatch(/^inline;/);
  });

  it('returns inline for PDF', () => {
    expect(getContentDisposition('application/pdf', 'doc.pdf')).toMatch(/^inline;/);
  });

  it('returns attachment for other types', () => {
    expect(getContentDisposition('application/zip', 'archive.zip')).toMatch(/^attachment;/);
    expect(getContentDisposition('application/octet-stream', 'file.bin')).toMatch(/^attachment;/);
    expect(getContentDisposition('text/csv', 'data.csv')).toMatch(/^attachment;/);
  });

  it('includes encoded filename', () => {
    const result = getContentDisposition('image/jpeg', 'my photo.jpg');
    expect(result).toContain('filename=');
    expect(result).toContain('my%20photo.jpg');
  });

  it('handles MIME type with charset parameter', () => {
    expect(getContentDisposition('image/jpeg; charset=binary', 'photo.jpg')).toMatch(/^inline;/);
  });
});

// ───────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────
describe('MIME_BLOCKLIST', () => {
  it('contains executable types', () => {
    expect(MIME_BLOCKLIST.has('application/x-executable')).toBe(true);
    expect(MIME_BLOCKLIST.has('application/x-msdownload')).toBe(true);
  });

  it('contains HTML/JS types', () => {
    expect(MIME_BLOCKLIST.has('text/html')).toBe(true);
    expect(MIME_BLOCKLIST.has('text/javascript')).toBe(true);
    expect(MIME_BLOCKLIST.has('application/javascript')).toBe(true);
  });
});

describe('SAFE_INLINE_TYPES', () => {
  it('includes common image types', () => {
    expect(SAFE_INLINE_TYPES.has('image/jpeg')).toBe(true);
    expect(SAFE_INLINE_TYPES.has('image/png')).toBe(true);
  });

  it('includes PDF', () => {
    expect(SAFE_INLINE_TYPES.has('application/pdf')).toBe(true);
  });

  it('does not include arbitrary types', () => {
    expect(SAFE_INLINE_TYPES.has('text/html')).toBe(false);
    expect(SAFE_INLINE_TYPES.has('application/zip')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────
// sanitizeSvg
// ───────────────────────────────────────────────────────────────────

describe('sanitizeSvg', () => {
  it('removes <script> tags with content', () => {
    const svg = '<svg><script>alert("xss")</script><circle/></svg>';
    expect(sanitizeSvg(svg)).toBe('<svg><circle/></svg>');
  });

  it('removes self-closing <script> tags', () => {
    const svg = '<svg><script src="evil.js" /><circle/></svg>';
    expect(sanitizeSvg(svg)).not.toContain('script');
    expect(sanitizeSvg(svg)).toContain('<circle/>');
  });

  it('removes event handler attributes', () => {
    const svg = '<svg><circle onclick="alert(1)" onload="hack()" r="5"/></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onload');
    expect(result).toContain('r="5"');
  });

  it('neutralizes javascript: protocol in href', () => {
    const svg = '<svg><a href="javascript:alert(1)"><text>Click</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('href="#');
  });

  it('neutralizes javascript: in xlink:href', () => {
    const svg = '<svg><a xlink:href="javascript:evil()"><text>X</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('javascript:');
  });

  it('removes <foreignObject> elements', () => {
    const svg = '<svg><foreignObject><body>html</body></foreignObject></svg>';
    expect(sanitizeSvg(svg)).toBe('<svg></svg>');
  });

  it('removes <iframe> elements', () => {
    const svg = '<svg><iframe src="evil.html"></iframe></svg>';
    expect(sanitizeSvg(svg)).not.toContain('iframe');
  });

  it('removes <embed> and <object> elements', () => {
    const svg = '<svg><embed src="x"/><object data="y"></object></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('embed');
    expect(result).not.toContain('object');
  });

  it('removes <style> blocks (CSS-based vectors)', () => {
    const svg = '<svg><style>@import url("evil.css");</style><circle/></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('@import');
    expect(result).not.toContain('<style');
    expect(result).toContain('<circle/>');
  });

  it('removes SMIL <set> that would rewrite href to a javascript: URL', () => {
    const svg =
      '<svg><a><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('<set');
    expect(result).not.toContain('javascript:');
  });

  it('removes SMIL <animate>/<animateTransform> elements', () => {
    const svg =
      '<svg><rect><animate attributeName="x" from="0" to="100"/><animateTransform type="rotate"/></rect></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('<animate');
    expect(result).not.toContain('animateTransform');
  });

  it('preserves valid SVG content', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="red"/></svg>';
    expect(sanitizeSvg(svg)).toBe(svg);
  });

  it('handles case-insensitive tag matching', () => {
    const svg = '<svg><SCRIPT>bad()</SCRIPT></svg>';
    expect(sanitizeSvg(svg)).toBe('<svg></svg>');
  });

  it('handles multiple dangerous elements', () => {
    const svg = '<svg><script>a()</script><circle onclick="b()" /><a href="javascript:c()"><text>t</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('script');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('<text>t</text>');
  });

  it('neutralizes data: URI in href', () => {
    const svg = '<svg><a href="data:text/html,<script>alert(1)</script>"><text>X</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('data:');
    expect(result).toContain('href="#');
  });

  it('neutralizes data: URI in xlink:href', () => {
    const svg = '<svg><a xlink:href="data:image/svg+xml,<script>evil()</script>"><text>X</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('data:');
  });

  it('neutralizes javascript: with leading whitespace in href', () => {
    const svg = '<svg><a href="  javascript:alert(1)"><text>Click</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('href="#');
  });

  it('neutralizes javascript: with leading newline/tab in href', () => {
    const svg = '<svg><a href="\n\tjavascript:alert(1)"><text>Click</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('javascript:');
  });

  it('neutralizes data: with leading whitespace in xlink:href', () => {
    const svg = '<svg><a xlink:href="  data:text/html,<script>x</script>"><text>X</text></a></svg>';
    const result = sanitizeSvg(svg);
    expect(result).not.toContain('data:');
  });
});
