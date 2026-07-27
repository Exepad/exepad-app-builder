import { describe, it, expect } from 'vitest';
import {
  parseSemver,
  isSemver,
  isDigest,
  compareSemver,
  classifyChange,
} from './version';

describe('parseSemver', () => {
  it('parses release and prerelease', () => {
    expect(parseSemver('1.4.2')).toEqual({ major: 1, minor: 4, patch: 2, prerelease: [] });
    expect(parseSemver('1.0.0-rc.1')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: ['rc', '1'] });
    expect(parseSemver('2.3.4+build.9')?.major).toBe(2);
  });
  it('rejects non-semver', () => {
    for (const bad of ['latest', 'edge', 'v1.2.3', '1.2', '1.2.x', '']) {
      expect(parseSemver(bad)).toBeNull();
      expect(isSemver(bad)).toBe(false);
    }
  });
});

describe('isDigest', () => {
  it('recognizes digest pins', () => {
    expect(isDigest('sha256:abc')).toBe(true);
    expect(isDigest('@sha256:abc')).toBe(true);
    expect(isDigest('1.2.3')).toBe(false);
  });
});

describe('compareSemver', () => {
  it('orders major/minor/patch', () => {
    expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    expect(compareSemver('1.4.2', '1.4.2')).toBe(0);
  });
  it('treats prerelease as lower than release', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBe(1);
  });
  it('orders prerelease identifiers', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1); // numeric < alnum
  });
  it('throws on non-semver', () => {
    expect(() => compareSemver('edge', '1.0.0')).toThrow();
  });
});

describe('classifyChange (the downgrade guard input)', () => {
  it('install when nothing deployed', () => {
    expect(classifyChange(null, '1.0.0')).toBe('install');
  });
  it('same / upgrade / downgrade', () => {
    expect(classifyChange('1.2.3', '1.2.3')).toBe('same');
    expect(classifyChange('1.2.3', '1.3.0')).toBe('upgrade');
    expect(classifyChange('2.0.0', '1.9.9')).toBe('downgrade');
  });
  it('unknown when either side is a channel/digest', () => {
    expect(classifyChange('1.2.3', 'edge')).toBe('unknown');
    expect(classifyChange('edge', '1.2.3')).toBe('unknown');
    expect(classifyChange('1.2.3', '@sha256:abc')).toBe('unknown');
  });
});
