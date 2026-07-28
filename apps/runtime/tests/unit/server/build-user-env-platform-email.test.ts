// @vitest-environment node
/**
 * buildUserEnv must bind the platform email proxy in self-host (2026-07-25).
 *
 * Auth email (signup verification + password reset) is sent by the app-backend
 * POSTing to the runtime's /api/platform/email/send proxy — the only place
 * RESEND_API_KEY lives. Under WfP that hop was a PLATFORM service binding; the
 * single-container runtime bound neither PLATFORM nor PLATFORM_URL, so
 * buildPlatformFetcher fell through to its `http://localhost:3000` default —
 * a port nothing listens on — and every verification/reset mail failed silently
 * (the auth handlers swallow send errors by design, so nothing surfaced).
 *
 * Two things must hold: a reachable PLATFORM_URL, and the shared secret the
 * proxy authenticates with (it 403s a wrong/absent X-Platform-Secret and 503s
 * when unconfigured, so binding the URL alone would still deliver nothing).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserEnv } from '../../../worker/src/server/build-user-env';

describe('buildUserEnv platform email binding', () => {
  // buildUserEnv opens the per-app SQLite eagerly, so it needs a writable data dir.
  let dataDir: string;
  const savedPort = process.env.EXEPAD_HTTP_ACTIVE_PORT;
  const savedSecret = process.env.PLATFORM_INTERNAL_SECRET;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'exepad-mail-'));
    process.env.EXEPAD_DATA_DIR = dataDir;
  });
  afterEach(() => {
    delete process.env.EXEPAD_DATA_DIR;
    delete process.env.EXEPAD_EMAIL_FROM;
    delete process.env.EXEPAD_EMAIL_FROM_NAME;
    delete process.env.EXEPAD_HTTP_ACTIVE_PORT;
    delete process.env.PLATFORM_INTERNAL_SECRET;
    if (savedPort !== undefined) process.env.EXEPAD_HTTP_ACTIVE_PORT = savedPort;
    if (savedSecret !== undefined) process.env.PLATFORM_INTERNAL_SECRET = savedSecret;
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('binds PLATFORM_URL to our own loopback listener, never the dead default', () => {
    process.env.EXEPAD_HTTP_ACTIVE_PORT = '8080';
    const env = buildUserEnv('appone', 'published');

    expect(env.PLATFORM_URL).toBe('http://127.0.0.1:8080');
    // The regression this guards: falling back to buildPlatformFetcher's default.
    expect(env.PLATFORM_URL).not.toContain('3000');
  });

  it('tracks the ACTUAL bound port, so the port-fallback path still reaches us', () => {
    // server/main.ts stamps EXEPAD_HTTP_ACTIVE_PORT once the listener binds; it
    // can differ from PORT when the configured port was occupied/privileged.
    process.env.PORT = '9999';
    process.env.EXEPAD_HTTP_ACTIVE_PORT = '8081';
    const env = buildUserEnv('apptwo', 'published');

    expect(env.PLATFORM_URL).toBe('http://127.0.0.1:8081');
    delete process.env.PORT;
  });

  it('hands the app-backend the secret the email proxy authenticates with', () => {
    process.env.PLATFORM_INTERNAL_SECRET = 'test-platform-secret';
    const env = buildUserEnv('appthree', 'published');

    expect(env.PLATFORM_INTERNAL_SECRET).toBe('test-platform-secret');
  });

  it('passes the operator From-address through to the app-backend', () => {
    // The transport's built-in default is noreply@exepad.com, which a self-hoster
    // cannot verify with their own email provider — the provider rejects the send,
    // so wiring the transport alone still delivers nothing.
    process.env.EXEPAD_EMAIL_FROM = 'noreply@my-company.test';
    process.env.EXEPAD_EMAIL_FROM_NAME = 'My Company';
    const env = buildUserEnv('appfive', 'published');

    expect(env.EMAIL_FROM_ADDRESS).toBe('noreply@my-company.test');
    expect(env.EMAIL_FROM_NAME).toBe('My Company');

    delete process.env.EXEPAD_EMAIL_FROM;
    delete process.env.EXEPAD_EMAIL_FROM_NAME;
  });

  it('leaves the secret undefined (not empty string) when unset', () => {
    delete process.env.PLATFORM_INTERNAL_SECRET;
    const env = buildUserEnv('appfour', 'published');

    // email.ts only stamps the X-Platform-Secret header `if (platformSecret)`,
    // so an empty string and undefined behave alike — but undefined keeps the
    // "unconfigured" state honest rather than sending an empty credential.
    expect(env.PLATFORM_INTERNAL_SECRET).toBeUndefined();
  });
});
