/**
 * Client-side wizard input validation — must mirror the worker's rules
 * (custom-domains.ts isValidDomain / isIpAddress) so nothing that passes here
 * is rejected by POST /api/domains for syntax, and vice versa on the cases the
 * wizard forwards.
 */
import { describe, it, expect } from 'vitest';
import {
  checkDomain,
  checkIp,
  cleanHostInput,
  isPrivateIp,
  sslipPreview,
} from '../../../client/src/components/settings/customdomains/domain-input';

describe('cleanHostInput', () => {
  it('strips scheme, path, port, trailing dot, whitespace; lowercases', () => {
    expect(cleanHostInput('https://App.Example.com/dashboard?x=1')).toBe('app.example.com');
    expect(cleanHostInput('http://example.com:8443/')).toBe('example.com');
    expect(cleanHostInput('  Example.COM.  ')).toBe('example.com');
    expect(cleanHostInput('example.com#frag')).toBe('example.com');
  });
  it('keeps a leading wildcard and does not mangle IPv6 colons', () => {
    expect(cleanHostInput('*.Apps.Example.com')).toBe('*.apps.example.com');
    expect(cleanHostInput('2001:db8::1')).toBe('2001:db8::1');
  });
});

describe('checkDomain', () => {
  it('accepts normal FQDNs and subdomains', () => {
    expect(checkDomain('app.example.com')).toEqual({ kind: 'ok', value: 'app.example.com' });
    expect(checkDomain('example.com')).toEqual({ kind: 'ok', value: 'example.com' });
    expect(checkDomain('https://app.example.com/x')).toEqual({ kind: 'ok', value: 'app.example.com' });
  });
  it('classifies empties, IPs, and wildcards instead of erroring', () => {
    expect(checkDomain('   ')).toEqual({ kind: 'empty' });
    expect(checkDomain('203.0.113.10')).toEqual({ kind: 'ip', value: '203.0.113.10' });
    expect(checkDomain('*.apps.example.com')).toEqual({ kind: 'wildcard', value: '*.apps.example.com' });
    expect(checkDomain('*.apps.example.com', { allowWildcard: true })).toEqual({
      kind: 'ok',
      value: '*.apps.example.com',
    });
  });
  it('rejects single labels, bad labels, over-long names, and *.tld (server parity)', () => {
    expect(checkDomain('localhost').kind).toBe('invalid');
    expect(checkDomain('bad_label.example.com').kind).toBe('invalid');
    expect(checkDomain('-x.example.com').kind).toBe('invalid');
    expect(checkDomain(`${'a'.repeat(64)}.example.com`).kind).toBe('invalid');
    expect(checkDomain(`${Array(40).fill('aaaaaaa').join('.')}.com`).kind).toBe('invalid');
    expect(checkDomain('*.com', { allowWildcard: true }).kind).toBe('invalid');
  });
});

describe('checkIp + isPrivateIp', () => {
  it('accepts public IPv4/IPv6 and rejects malformed input', () => {
    expect(checkIp('203.0.113.10')).toEqual({ kind: 'ok', value: '203.0.113.10' });
    expect(checkIp('2001:db8::1')).toEqual({ kind: 'ok', value: '2001:db8::1' });
    expect(checkIp('999.1.1.1').kind).toBe('invalid');
    expect(checkIp('example.com').kind).toBe('invalid');
    expect(checkIp('').kind).toBe('empty');
  });
  it('blocks private / loopback / link-local / CGNAT ranges (sslip can never issue there)', () => {
    for (const ip of [
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.20',
      '127.0.0.1',
      '169.254.0.5',
      '100.64.0.1', // CGNAT low edge
      '100.71.4.2', // Starlink-style
      '100.127.255.255', // CGNAT high edge
    ]) {
      expect(checkIp(ip)).toEqual({ kind: 'private', value: ip });
      expect(isPrivateIp(ip)).toBe(true);
    }
    // 100.63/100.128 are OUTSIDE 100.64.0.0/10 — must stay public.
    expect(isPrivateIp('100.63.0.1')).toBe(false);
    expect(isPrivateIp('100.128.0.1')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
  });
});

describe('sslipPreview', () => {
  it('mirrors the server sslip derivation', () => {
    expect(sslipPreview('203.0.113.10')).toBe('203-0-113-10.sslip.io');
    expect(sslipPreview('2001:db8::1')).toBe('2001-db8--1.sslip.io');
    expect(sslipPreview('not-an-ip')).toBeNull();
  });
});
