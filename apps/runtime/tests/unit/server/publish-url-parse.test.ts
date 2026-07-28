// @vitest-environment node
/**
 * Unit tests for the cloudflared stderr URL parser. The banner format is not a
 * stable public API, so this pins the exact extraction behaviour incl. the
 * `api.trycloudflare.com` control-endpoint decoy guard.
 */
import { describe, it, expect } from 'vitest';
import { _extractTunnelUrl } from '../../../worker/src/routes/publish';

describe('_extractTunnelUrl', () => {
  it('extracts the URL from a banner line', () => {
    const line =
      '2026-06-16T10:00:00Z INF |  https://seasonal-deck-organisms-sf.trycloudflare.com  |';
    expect(_extractTunnelUrl(line)).toBe('https://seasonal-deck-organisms-sf.trycloudflare.com');
  });

  it('extracts a bare URL on its own', () => {
    expect(_extractTunnelUrl('https://random-words-1234.trycloudflare.com')).toBe(
      'https://random-words-1234.trycloudflare.com',
    );
  });

  it('strips ANSI colour codes before matching', () => {
    const line = '\x1b[32mINF\x1b[0m https://blue-sky-9.trycloudflare.com\x1b[0m';
    expect(_extractTunnelUrl(line)).toBe('https://blue-sky-9.trycloudflare.com');
  });

  it('ignores the api.trycloudflare.com control-endpoint decoy', () => {
    expect(
      _extractTunnelUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel"'),
    ).toBeNull();
  });

  it('accepts a hostname that merely starts with "api-" (not the api. decoy)', () => {
    expect(_extractTunnelUrl('https://api-server-7.trycloudflare.com')).toBe(
      'https://api-server-7.trycloudflare.com',
    );
  });

  it('returns null for lines without a tunnel URL', () => {
    expect(_extractTunnelUrl('INF Registered tunnel connection connIndex=0')).toBeNull();
    expect(_extractTunnelUrl('')).toBeNull();
  });
});
