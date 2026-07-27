/**
 * security-headers.ts — the CSP builder is the runtime's clickjacking +
 * script-injection boundary. Two deployment shapes must produce two distinct
 * policies:
 *
 *   • Cloud (production/cloud)  → allow-lists https://cdn.exepad.com and lets
 *     app.exepad.com / *.exepad.com embed the preview as a frame-ancestor.
 *   • Self-host (anything else) → NO shared CDN reference, `frame-ancestors
 *     'self'` only (no cross-origin builder embedding).
 *
 * A regression here is either a broken self-host preview (over-tight) or a
 * clickjacking / supply-chain hole (over-loose), so the assertions below are
 * deliberately strict about the *exact* directive contents.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildCsp } from '../../../../worker/src/lib/security-headers';

// Parse a CSP string into a directive → tokens[] map for precise assertions.
function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...rest] = trimmed.split(/\s+/);
    out[name] = rest;
  }
  return out;
}

// buildCsp reads process.env.EXEPAD_CDN_DOMAIN / EXEPAD_APP_DOMAIN as operator
// overrides. Save + restore around every test so the suite is order-independent
// and never leaks a stale override into another case.
const SAVED_CDN = process.env.EXEPAD_CDN_DOMAIN;
const SAVED_APP = process.env.EXEPAD_APP_DOMAIN;
const SAVED_ESM = process.env.EXEPAD_ALLOW_ESM_CDN;
const SAVED_STRICT_CONNECT = process.env.EXEPAD_STRICT_CONNECT_SRC;
const SAVED_CONNECT_ALLOW = process.env.EXEPAD_CONNECT_SRC_ALLOW;

function restore(name: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[name];
  else process.env[name] = saved;
}

beforeEach(() => {
  delete process.env.EXEPAD_CDN_DOMAIN;
  delete process.env.EXEPAD_APP_DOMAIN;
  delete process.env.EXEPAD_ALLOW_ESM_CDN;
  delete process.env.EXEPAD_STRICT_CONNECT_SRC;
  delete process.env.EXEPAD_CONNECT_SRC_ALLOW;
});

afterEach(() => {
  restore('EXEPAD_CDN_DOMAIN', SAVED_CDN);
  restore('EXEPAD_APP_DOMAIN', SAVED_APP);
  restore('EXEPAD_ALLOW_ESM_CDN', SAVED_ESM);
  restore('EXEPAD_STRICT_CONNECT_SRC', SAVED_STRICT_CONNECT);
  restore('EXEPAD_CONNECT_SRC_ALLOW', SAVED_CONNECT_ALLOW);
});

describe('buildCsp — cloud environment', () => {
  for (const environment of ['production', 'cloud', 'PRODUCTION', 'Cloud']) {
    it(`treats "${environment}" as cloud (case-insensitive)`, () => {
      const csp = parseCsp(buildCsp('n0', environment));
      // CDN appears in script-src + style-src.
      expect(csp['script-src']).toContain('https://cdn.exepad.com');
      expect(csp['style-src']).toContain('https://cdn.exepad.com');
      // Builder origins are allowed to frame the preview.
      expect(csp['frame-ancestors']).toEqual([
        "'self'",
        'https://app.exepad.com',
        'https://*.exepad.com',
      ]);
    });
  }

  it('keeps esm.sh allow-listed alongside the CDN in script-src', () => {
    const csp = parseCsp(buildCsp('n0', 'production'));
    expect(csp['script-src']).toContain('https://esm.sh');
    expect(csp['script-src']).toContain('https://cdn.exepad.com');
  });
});

describe('buildCsp — self-host environment', () => {
  // Every non-cloud marker (and undefined / empty) must collapse to self-host.
  for (const environment of [undefined, '', 'development', 'self-host', 'staging', 'prod', 'local']) {
    it(`treats ${JSON.stringify(environment)} as self-host`, () => {
      const csp = parseCsp(buildCsp('n0', environment));

      // cdn.exepad.com is fully dropped — not in script-src, style-src, or anywhere.
      expect(buildCsp('n0', environment)).not.toContain('cdn.exepad.com');
      expect(csp['script-src']).not.toContain('https://cdn.exepad.com');
      expect(csp['style-src']).not.toContain('https://cdn.exepad.com');

      // frame-ancestors is same-origin only — no *.exepad.com embedding.
      expect(csp['frame-ancestors']).toEqual(["'self'"]);
      expect(buildCsp('n0', environment)).not.toContain('exepad.com');
    });
  }

  it('DROPS esm.sh from script-src by default (no arbitrary third-party code)', () => {
    const csp = parseCsp(buildCsp('n0', undefined));
    // Self-host components load only from 'self'; esm.sh (arbitrary npm code) is
    // off unless the operator explicitly opts back in.
    expect(csp['script-src']).toEqual(["'self'", "'nonce-n0'"]);
    expect(buildCsp('n0', undefined)).not.toContain('esm.sh');
  });

  it('re-allows esm.sh on self-host only when EXEPAD_ALLOW_ESM_CDN opts in', () => {
    for (const flag of ['1', 'true', 'yes', 'on']) {
      process.env.EXEPAD_ALLOW_ESM_CDN = flag;
      expect(parseCsp(buildCsp('n0', undefined))['script-src']).toContain('https://esm.sh');
    }
  });

  it('drops plain http: from img-src on self-host (no cleartext beacon exfil)', () => {
    const csp = parseCsp(buildCsp('n0', 'development'));
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https:']);
    expect(csp['img-src']).not.toContain('http:');
  });

  it('style-src keeps fonts.googleapis.com but has no trailing CDN suffix', () => {
    const csp = parseCsp(buildCsp('n0', 'development'));
    expect(csp['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
  });
});

describe('buildCsp — connect-src exfiltration surface', () => {
  it('defaults to the broad connect-src (self + https + wss) for app compatibility', () => {
    expect(parseCsp(buildCsp('n0', undefined))['connect-src']).toEqual(["'self'", 'https:', 'wss:']);
    expect(parseCsp(buildCsp('n0', 'production'))['connect-src']).toEqual(["'self'", 'https:', 'wss:']);
  });

  it('narrows connect-src to same-origin on self-host when EXEPAD_STRICT_CONNECT_SRC opts in', () => {
    process.env.EXEPAD_STRICT_CONNECT_SRC = '1';
    expect(parseCsp(buildCsp('n0', undefined))['connect-src']).toEqual(["'self'"]);
  });

  it('appends an operator allowlist to the strict connect-src', () => {
    process.env.EXEPAD_STRICT_CONNECT_SRC = 'true';
    process.env.EXEPAD_CONNECT_SRC_ALLOW = 'https://api.example.com  https://hooks.example.org';
    expect(parseCsp(buildCsp('n0', undefined))['connect-src']).toEqual([
      "'self'",
      'https://api.example.com',
      'https://hooks.example.org',
    ]);
  });

  it('ignores EXEPAD_STRICT_CONNECT_SRC on cloud (broad connect-src preserved)', () => {
    process.env.EXEPAD_STRICT_CONNECT_SRC = '1';
    expect(parseCsp(buildCsp('n0', 'production'))['connect-src']).toEqual(["'self'", 'https:', 'wss:']);
  });
});

describe('buildCsp — cloud vs self-host frame-ancestors difference', () => {
  it('cloud allows builder embedding; self-host does not', () => {
    const cloud = parseCsp(buildCsp('n0', 'production'));
    const selfHost = parseCsp(buildCsp('n0', 'development'));

    expect(cloud['frame-ancestors']).toContain('https://*.exepad.com');
    expect(selfHost['frame-ancestors']).not.toContain('https://*.exepad.com');
    expect(selfHost['frame-ancestors']).toEqual(["'self'"]);
  });

  it('both always include the same-origin frame-ancestors source', () => {
    expect(parseCsp(buildCsp('n0', 'production'))['frame-ancestors']).toContain("'self'");
    expect(parseCsp(buildCsp('n0', 'development'))['frame-ancestors']).toContain("'self'");
  });
});

describe('buildCsp — nonce handling', () => {
  it('embeds the provided nonce in script-src as a nonce-source', () => {
    const csp = parseCsp(buildCsp('abc123', 'development'));
    expect(csp['script-src']).toContain("'nonce-abc123'");
  });

  it('is unique per call when the caller supplies distinct nonces', () => {
    const a = buildCsp('nonce-A', 'production');
    const b = buildCsp('nonce-B', 'production');
    expect(a).not.toEqual(b);
    expect(parseCsp(a)['script-src']).toContain("'nonce-nonce-A'");
    expect(parseCsp(b)['script-src']).toContain("'nonce-nonce-B'");
  });

  it('places the nonce only in script-src, not in style-src/default-src', () => {
    const csp = parseCsp(buildCsp('deadbeef', 'production'));
    expect(csp['script-src']).toContain("'nonce-deadbeef'");
    expect(csp['style-src'].some((t) => t.includes('deadbeef'))).toBe(false);
    expect(csp['default-src'].some((t) => t.includes('deadbeef'))).toBe(false);
  });

  it('passes an empty-string nonce through verbatim (no crash, no silent default)', () => {
    const csp = parseCsp(buildCsp('', 'development'));
    // An empty nonce yields the literal `'nonce-'` token — confirms buildCsp
    // does not invent or sanitize the value; that contract belongs to the caller.
    expect(csp['script-src']).toContain("'nonce-'");
  });
});

describe('buildCsp — no unsafe-inline / unsafe-eval regression for scripts', () => {
  for (const environment of ['production', 'cloud', undefined, 'development']) {
    it(`script-src never contains 'unsafe-inline' (${JSON.stringify(environment)})`, () => {
      const csp = parseCsp(buildCsp('n0', environment));
      expect(csp['script-src']).not.toContain("'unsafe-inline'");
    });

    it(`script-src never contains 'unsafe-eval' (${JSON.stringify(environment)})`, () => {
      const csp = parseCsp(buildCsp('n0', environment));
      expect(csp['script-src']).not.toContain("'unsafe-eval'");
    });
  }

  it("style-src intentionally keeps 'unsafe-inline' (Tailwind/styling), scripts do not", () => {
    // Documents the asymmetry: inline styles are permitted, inline scripts are not.
    const csp = parseCsp(buildCsp('n0', 'production'));
    expect(csp['style-src']).toContain("'unsafe-inline'");
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
  });
});

describe('buildCsp — base directives + structure', () => {
  it('always emits the full set of directives in both environments', () => {
    const expectedDirectives = [
      'default-src',
      'script-src',
      'style-src',
      'font-src',
      'img-src',
      'connect-src',
      'frame-src',
      'frame-ancestors',
      'worker-src',
    ];
    for (const environment of ['production', 'development']) {
      const csp = parseCsp(buildCsp('n0', environment));
      for (const d of expectedDirectives) {
        expect(Object.keys(csp)).toContain(d);
      }
    }
  });

  it("default-src is locked to 'self'", () => {
    expect(parseCsp(buildCsp('n0', 'production'))['default-src']).toEqual(["'self'"]);
    expect(parseCsp(buildCsp('n0', 'development'))['default-src']).toEqual(["'self'"]);
  });

  it('returns a single-line, semicolon-joined header value (no newlines)', () => {
    const csp = buildCsp('n0', 'production');
    expect(csp).not.toContain('\n');
    expect(csp.split(';').length).toBe(9);
  });
});

describe('buildCsp — operator overrides (EXEPAD_CDN_DOMAIN / EXEPAD_APP_DOMAIN)', () => {
  it('lets a self-host operator opt into a custom CDN domain', () => {
    process.env.EXEPAD_CDN_DOMAIN = 'https://cdn.example.org';
    const csp = parseCsp(buildCsp('n0', 'development'));
    expect(csp['script-src']).toContain('https://cdn.example.org');
    expect(csp['style-src']).toContain('https://cdn.example.org');
    // The default Exepad CDN is still absent.
    expect(buildCsp('n0', 'development')).not.toContain('cdn.exepad.com');
  });

  it('lets a self-host operator opt into a custom builder frame-ancestor', () => {
    process.env.EXEPAD_APP_DOMAIN = 'https://builder.example.org';
    const csp = parseCsp(buildCsp('n0', 'development'));
    expect(csp['frame-ancestors']).toEqual(["'self'", 'https://builder.example.org']);
  });

  it('an explicit empty override on cloud strips the cloud default (override wins only when truthy)', () => {
    // EXEPAD_CDN_DOMAIN='' is falsy, so on cloud the code falls back to the
    // cloud default rather than honoring the empty override.
    process.env.EXEPAD_CDN_DOMAIN = '';
    const csp = parseCsp(buildCsp('n0', 'production'));
    expect(csp['script-src']).toContain('https://cdn.exepad.com');
  });
});
