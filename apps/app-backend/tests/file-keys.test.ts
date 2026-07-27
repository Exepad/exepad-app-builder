/**
 * Tests for R2 key builder and path traversal guard
 */

import { describe, it, expect } from 'vitest';
import { assertNoPathTraversal, buildR2Key, buildFileUrl } from '../src/file/keys';

// ───────────────────────────────────────────────────────────────────
// assertNoPathTraversal
// ───────────────────────────────────────────────────────────────────
describe('assertNoPathTraversal', () => {
  it('allows clean components', () => {
    expect(() => assertNoPathTraversal('app-123', 'user-456', 'abc-def', 'photo.jpg')).not.toThrow();
  });

  it('allows UUIDs', () => {
    expect(() => assertNoPathTraversal('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
  });

  it('rejects components with ".."', () => {
    expect(() => assertNoPathTraversal('..', 'valid')).toThrow(/Path traversal/);
    expect(() => assertNoPathTraversal('valid', 'foo..bar')).toThrow(/Path traversal/);
  });

  it('rejects components with forward slash', () => {
    expect(() => assertNoPathTraversal('path/traversal')).toThrow(/Path traversal/);
  });

  it('rejects components with backslash', () => {
    expect(() => assertNoPathTraversal('path\\traversal')).toThrow(/Path traversal/);
  });

  it('rejects components with null byte', () => {
    expect(() => assertNoPathTraversal('file\0name')).toThrow(/Path traversal/);
  });

  it('checks all components', () => {
    expect(() => assertNoPathTraversal('ok', 'ok', 'ok', '../bad')).toThrow(/Path traversal/);
  });
});

// ───────────────────────────────────────────────────────────────────
// buildR2Key
// ───────────────────────────────────────────────────────────────────
describe('buildR2Key', () => {
  it('builds correct key format (no appId — per-app bucket isolation)', () => {
    const key = buildR2Key('user-456', 'file-789', 'photo.jpg');
    expect(key).toBe('user-456/file-789/photo.jpg');
  });

  it('sanitizes the filename', () => {
    const key = buildR2Key('user-1', 'file-1', '../../../etc/passwd');
    // sanitizeFilename strips traversal → "etcpasswd"
    expect(key).toBe('user-1/file-1/etcpasswd');
    expect(key).not.toContain('..');
  });

  it('falls back to "unnamed" for empty filename', () => {
    const key = buildR2Key('user-1', 'file-1', '');
    expect(key).toBe('user-1/file-1/unnamed');
  });

  it('throws if ownerId contains traversal', () => {
    expect(() => buildR2Key('../evil', 'file', 'name.jpg')).toThrow(/Path traversal/);
  });

  it('throws if ownerId contains slash', () => {
    expect(() => buildR2Key('user/bad', 'file', 'name.jpg')).toThrow(/Path traversal/);
  });
});

// ───────────────────────────────────────────────────────────────────
// buildFileUrl
// ───────────────────────────────────────────────────────────────────
describe('buildFileUrl', () => {
  it('builds correct URL path', () => {
    const url = buildFileUrl('my-app', 'file-123', 'photo.jpg');
    expect(url).toBe('/api/my-app/_files/file-123/photo.jpg');
  });

  it('encodes special characters in filename', () => {
    const url = buildFileUrl('app', 'file-1', 'my photo (1).jpg');
    expect(url).toContain('my%20photo%20');
    expect(url).toContain('1');
    expect(url).toContain('.jpg');
  });

  it('sanitizes traversal attempts in filename', () => {
    const url = buildFileUrl('app', 'file-1', '../../etc/passwd');
    expect(url).not.toContain('..');
  });
});
