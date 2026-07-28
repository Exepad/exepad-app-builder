// @vitest-environment node
/**
 * ensureSelfSignedCert — the zero-config in-process HTTPS cert provisioner.
 *
 * Exercises real openssl (baked into the image; present on dev machines), so it
 * validates the actual generation path the runtime uses at boot.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';

import { ensureSelfSignedCert } from '../../../worker/src/server/self-signed-cert';

let dir: string;
let certFile: string;
let keyFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exepad-cert-'));
  certFile = join(dir, 'certs', 'cert.pem');
  keyFile = join(dir, 'certs', 'key.pem');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ensureSelfSignedCert', () => {
  it('mints a valid cert + key covering localhost and loopback when absent', () => {
    const res = ensureSelfSignedCert({ certFile, keyFile });
    expect(res).not.toBeNull();
    expect(res!.generated).toBe(true);
    expect(existsSync(certFile)).toBe(true);
    expect(existsSync(keyFile)).toBe(true);

    const cert = new X509Certificate(readFileSync(certFile));
    expect(cert.subjectAltName).toContain('DNS:localhost');
    expect(cert.subjectAltName).toContain('DNS:*.localhost');
    expect(cert.subjectAltName).toContain('IP Address:127.0.0.1');
    // Not expired.
    expect(Date.parse(cert.validTo) - Date.now()).toBeGreaterThan(0);
  });

  it('includes the public IP + its derived sslip hostname in the SANs', () => {
    const res = ensureSelfSignedCert({ certFile, keyFile, publicIp: '203.0.113.10' });
    expect(res!.generated).toBe(true);
    const cert = new X509Certificate(readFileSync(certFile));
    expect(cert.subjectAltName).toContain('IP Address:203.0.113.10');
    expect(cert.subjectAltName).toContain('DNS:203-0-113-10.sslip.io');
  });

  it('writes the private key owner-read-only (0600)', () => {
    ensureSelfSignedCert({ certFile, keyFile });
    // Low 9 perm bits; skip on platforms without POSIX perms (mode 0 there).
    const mode = statSync(keyFile).mode & 0o777;
    if (mode !== 0) expect(mode).toBe(0o600);
  });

  it('is idempotent — a second call reuses the existing valid pair untouched', () => {
    const first = ensureSelfSignedCert({ certFile, keyFile });
    const body1 = readFileSync(certFile, 'utf8');
    const second = ensureSelfSignedCert({ certFile, keyFile });
    expect(first!.generated).toBe(true);
    expect(second!.generated).toBe(false);
    expect(readFileSync(certFile, 'utf8')).toBe(body1); // unchanged
  });

  it('regenerates when the cert is removed', () => {
    ensureSelfSignedCert({ certFile, keyFile });
    rmSync(certFile);
    const again = ensureSelfSignedCert({ certFile, keyFile });
    expect(again!.generated).toBe(true);
    expect(existsSync(certFile)).toBe(true);
  });
});
