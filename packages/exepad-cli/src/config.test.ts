import { describe, it, expect } from 'vitest';
import { isArchSupported, SUPPORTED_ARCHS } from './config';

describe('isArchSupported (multi-arch guard)', () => {
  it('accepts amd64 + arm64 (Node os.arch names)', () => {
    expect(isArchSupported('x64')).toBe(true);
    expect(isArchSupported('arm64')).toBe(true);
  });
  it('rejects other arches', () => {
    for (const a of ['ia32', 'arm', 'ppc64', 's390x', 'mips']) {
      expect(isArchSupported(a)).toBe(false);
    }
  });
  it('SUPPORTED_ARCHS is exactly x64 + arm64', () => {
    expect([...SUPPORTED_ARCHS].sort()).toEqual(['arm64', 'x64']);
  });
});
