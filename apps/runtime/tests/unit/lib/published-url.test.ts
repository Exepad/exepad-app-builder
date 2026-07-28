/**
 * resolvePublishedAppUrl — canonical public URL for a published/preview app.
 *
 * The requirement: a self-host published app's URL must be
 * `https://<host>/a/<alias>` (scheme pinned to https, no port), regardless of
 * how the Studio itself was loaded — plain HTTP, or a dev/worker port. Absolute
 * URLs (custom domains, tunnels) pass through untouched.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolvePublishedAppUrl } from '@/lib/published-url';

function setOrigin(origin: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL(origin) as unknown as Location,
  });
}

describe('resolvePublishedAppUrl', () => {
  afterEach(() => {
    // Restore a clean location between cases.
    setOrigin('http://localhost/');
  });

  it('pins http localhost to https with no port', () => {
    setOrigin('http://localhost/');
    expect(resolvePublishedAppUrl('/a/avfhfwzn8/')).toBe('https://localhost/a/avfhfwzn8/');
  });

  it('strips a dev/worker port', () => {
    setOrigin('http://localhost:8080/');
    expect(resolvePublishedAppUrl('/a/avfhfwzn8/')).toBe('https://localhost/a/avfhfwzn8/');
  });

  it('leaves an already-https no-port origin unchanged in shape', () => {
    setOrigin('https://localhost/');
    expect(resolvePublishedAppUrl('/a/avfhfwzn8/')).toBe('https://localhost/a/avfhfwzn8/');
  });

  it('preserves a LAN-IP / custom host, still forcing https', () => {
    setOrigin('http://192.168.1.50:3001/');
    expect(resolvePublishedAppUrl('/a/foo/')).toBe('https://192.168.1.50/a/foo/');
  });

  it('passes absolute custom-domain / tunnel URLs through untouched', () => {
    setOrigin('http://localhost:8080/');
    expect(resolvePublishedAppUrl('https://myapp.example.com/a/foo/')).toBe(
      'https://myapp.example.com/a/foo/',
    );
  });

  it('returns null/undefined unchanged', () => {
    expect(resolvePublishedAppUrl(null)).toBeNull();
    expect(resolvePublishedAppUrl(undefined)).toBeUndefined();
  });
});
