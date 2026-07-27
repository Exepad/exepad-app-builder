import { describe, it, expect, afterEach } from 'vitest';
import { singleAppId, isSingleAppMode, isBlockedInSingleApp } from '../../../worker/src/lib/single-app';

const ORIGINAL = process.env.EXEPAD_SINGLE_APP_ID;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXEPAD_SINGLE_APP_ID;
  else process.env.EXEPAD_SINGLE_APP_ID = ORIGINAL;
});

describe('single-app mode toggle', () => {
  it('is off by default / empty', () => {
    delete process.env.EXEPAD_SINGLE_APP_ID;
    expect(isSingleAppMode()).toBe(false);
    expect(singleAppId()).toBe('');
    process.env.EXEPAD_SINGLE_APP_ID = '   ';
    expect(isSingleAppMode()).toBe(false);
  });

  it('is on when set (trimmed)', () => {
    process.env.EXEPAD_SINGLE_APP_ID = '  ag35xetdj  ';
    expect(isSingleAppMode()).toBe(true);
    expect(singleAppId()).toBe('ag35xetdj');
  });
});

describe('isBlockedInSingleApp', () => {
  it('blocks the builder/operator/agent surface', () => {
    for (const p of [
      '/agent/r',
      '/api/orchestrate/build',
      '/api/deploy/x',
      '/api/deprovision/x',
      '/api/admin/apps',
      '/api/settings/llm',
      '/auth/login',
      '/auth/setup',
      '/api/ag35xetdj/_diag/query_db',
    ]) {
      expect(isBlockedInSingleApp(p), p).toBe(true);
    }
  });

  it('allows the app-serving surface + health probe', () => {
    for (const p of [
      '/',
      '/portfolio',
      '/auth/status', // health probe exemption
      '/api/ag35xetdj/rpc',
      '/api/ag35xetdj/app-config',
      '/repo/published/releases/x/components/Home.js',
      '/published/assets/hero.png',
      '/verify-email',
      '/robots.txt',
    ]) {
      expect(isBlockedInSingleApp(p), p).toBe(false);
    }
  });
});
