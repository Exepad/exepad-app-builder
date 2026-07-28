/**
 * Runtime client lib utils — focused unit suite.
 *
 * Covers four small-but-load-bearing utilities that the rendering/data layer
 * leans on, with emphasis on the edge cases + security vectors the focus areas
 * call out:
 *   - fetchDedup       → in-flight sharing, TTL expiry, rejected-request eviction
 *   - imageDimensionGuard → the URL dimension-extraction regex matrix + bounds
 *   - previewRetry     → retryable-code gating + exponential backoff timing
 *   - colors           → hex/rgb/hsl converters, luminance, contrast, parsing
 *
 * Plain Vitest under happy-dom (see vitest.config.ts), same harness as the
 * sibling lib tests (color-contrast.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { dedupedFetch, invalidateDedup } from '@/lib/fetchDedup';
import { extractImageDims } from '@/lib/imageDimensionGuard';
import { fetchWithPreviewRetry } from '@/lib/previewRetry';
import {
  hexToHsl,
  hexToRgb,
  cssRgbToHex,
  cssHslToHex,
  parseArbitraryColorValue,
  getLuminance,
  getContrastRatio,
  meetsContrastRequirement,
  isDarkColor,
  getContrastingTextColor,
} from '@/lib/colors';

// ---------------------------------------------------------------------------
// fetchDedup — dedupedFetch / invalidateDedup
// ---------------------------------------------------------------------------

describe('fetchDedup.dedupedFetch', () => {
  beforeEach(() => {
    // The module cache is process-global; clear any keys this file uses so
    // ordering between tests never leaks a resolved/cached entry.
    invalidateDedup('');
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    invalidateDedup('');
  });

  it('shares one in-flight promise across concurrent identical keys', async () => {
    let calls = 0;
    let resolveFn!: (v: string) => void;
    const fetchFn = vi.fn(() => {
      calls++;
      return new Promise<string>((res) => {
        resolveFn = res;
      });
    });

    const p1 = dedupedFetch('k:concurrent', fetchFn);
    const p2 = dedupedFetch('k:concurrent', fetchFn);
    const p3 = dedupedFetch('k:concurrent', fetchFn);

    // Same Promise identity — only one underlying request was issued.
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    expect(calls).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    resolveFn('payload');
    await expect(p1).resolves.toBe('payload');
    await expect(p2).resolves.toBe('payload');
    await expect(p3).resolves.toBe('payload');
  });

  it('serves the cached result within the TTL window (no second fetch)', async () => {
    const fetchFn = vi.fn(async () => 'first');

    await dedupedFetch('k:ttl', fetchFn);
    // Second call immediately after resolution → still inside CACHE_TTL (3s).
    const second = await dedupedFetch('k:ttl', fetchFn);

    expect(second).toBe('first');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has expired', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchFn = vi.fn(async () => `v${++n}`);

    const r1 = await dedupedFetch('k:expire', fetchFn);
    expect(r1).toBe('v1');

    // CACHE_TTL is 3_000ms; advance past it so the entry is stale.
    vi.advanceTimersByTime(3_001);

    const r2 = await dedupedFetch('k:expire', fetchFn);
    expect(r2).toBe('v2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('evicts a rejected request immediately so the next call retries', async () => {
    let attempt = 0;
    const fetchFn = vi.fn(() => {
      attempt++;
      return attempt === 1
        ? Promise.reject(new Error('boom'))
        : Promise.resolve('recovered');
    });

    await expect(dedupedFetch('k:reject', fetchFn)).rejects.toThrow('boom');

    // A rejected request must NOT be cached — the retry issues a fresh fetch.
    const retry = await dedupedFetch('k:reject', fetchFn);
    expect(retry).toBe('recovered');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('a rejection propagates to every concurrent caller of the shared promise', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('shared-fail')));

    const p1 = dedupedFetch('k:reject-shared', fetchFn);
    const p2 = dedupedFetch('k:reject-shared', fetchFn);
    expect(p1).toBe(p2);

    await expect(p1).rejects.toThrow('shared-fail');
    await expect(p2).rejects.toThrow('shared-fail');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keys are independent — different keys do not collide', async () => {
    const a = vi.fn(async () => 'A');
    const b = vi.fn(async () => 'B');

    const [ra, rb] = await Promise.all([
      dedupedFetch('k:A', a),
      dedupedFetch('k:B', b),
    ]);

    expect(ra).toBe('A');
    expect(rb).toBe('B');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('fetchDedup.invalidateDedup', () => {
  beforeEach(() => invalidateDedup(''));
  afterEach(() => invalidateDedup(''));

  it('drops cached entries by prefix so the next fetch is fresh', async () => {
    const fetchFn = vi.fn(async () => 'cached');

    await dedupedFetch('model:app1:books', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Mutation → invalidate the model prefix.
    invalidateDedup('model:app1:');

    await dedupedFetch('model:app1:books', fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('only invalidates entries matching the prefix, leaving others cached', async () => {
    const books = vi.fn(async () => 'books');
    const users = vi.fn(async () => 'users');

    await dedupedFetch('model:app1:books', books);
    await dedupedFetch('model:app2:users', users);

    invalidateDedup('model:app1:');

    // app1 was invalidated → refetch; app2 still cached → no refetch.
    await dedupedFetch('model:app1:books', books);
    await dedupedFetch('model:app2:users', users);

    expect(books).toHaveBeenCalledTimes(2);
    expect(users).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// imageDimensionGuard.extractImageDims — regex matrix
// ---------------------------------------------------------------------------

describe('extractImageDims', () => {
  it('returns null for empty/whitespace src', () => {
    expect(extractImageDims('')).toBeNull();
    // A non-dimension URL yields no match.
    expect(extractImageDims('https://example.com/logo.svg')).toBeNull();
  });

  it('parses ?w=&h= query params (width first)', () => {
    expect(extractImageDims('https://img.cdn/x.jpg?w=600&h=700')).toEqual({ w: 600, h: 700 });
    expect(extractImageDims('https://img.cdn/x.jpg?width=1200&height=630')).toEqual({ w: 1200, h: 630 });
  });

  it('parses ?h=&w= query params (height first → order swapped back)', () => {
    expect(extractImageDims('https://img.cdn/x.jpg?h=700&w=600')).toEqual({ w: 600, h: 700 });
    expect(extractImageDims('https://img.cdn/x.jpg?height=630&width=1200')).toEqual({ w: 1200, h: 630 });
  });

  it('parses an embedded _WxH / -WxH segment', () => {
    expect(extractImageDims('https://cdn/photo_640x480.jpg')).toEqual({ w: 640, h: 480 });
    expect(extractImageDims('https://cdn/banner-1200x630.png')).toEqual({ w: 1200, h: 630 });
    expect(extractImageDims('https://cdn/a/300x200/b.webp')).toEqual({ w: 300, h: 200 });
  });

  it('parses picsum-style trailing /W/H path segments', () => {
    expect(extractImageDims('https://picsum.photos/600/400')).toEqual({ w: 600, h: 400 });
    expect(extractImageDims('https://picsum.photos/600/400?grayscale')).toEqual({ w: 600, h: 400 });
  });

  it('matches the FIRST /W/H path pair when several appear (greedy left-most)', () => {
    // /id/237/800/1200 → the regex is non-global and takes the left-most match,
    // so /237/800/ wins over the intended /800/1200. Documents the actual,
    // order-sensitive behavior rather than the "last pair" one might expect.
    expect(extractImageDims('https://picsum.photos/id/237/800/1200')).toEqual({ w: 237, h: 800 });
  });

  it('rejects single-digit and over-bounds dimensions', () => {
    // Patterns require 2–5 digits, so single digits never match.
    expect(extractImageDims('https://picsum.photos/6/4')).toBeNull();
    // 6-digit numbers fall outside the \d{2,5} capture entirely.
    expect(extractImageDims('https://cdn/x_100000x200000.jpg')).toBeNull();
  });

  it('clamps the upper bound at 10000 per axis', () => {
    // 99999 is 5 digits (capturable) but > 10000 → rejected by the bounds check.
    expect(extractImageDims('https://cdn/x_99999x500.jpg')).toBeNull();
    // Exactly at the boundary is accepted.
    expect(extractImageDims('https://cdn/x_10000x10000.jpg')).toEqual({ w: 10000, h: 10000 });
  });

  it('prefers the most-specific pattern (query over path segment)', () => {
    // Has both a /600/400 path and a ?w=&h= query; the query pattern is first.
    expect(extractImageDims('https://picsum.photos/600/400?w=320&h=240')).toEqual({ w: 320, h: 240 });
  });
});

// ---------------------------------------------------------------------------
// previewRetry.fetchWithPreviewRetry — retryable codes + backoff
// ---------------------------------------------------------------------------

describe('fetchWithPreviewRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passes through unchanged (single call, no retry) when not in preview', async () => {
    const fetchFn = vi.fn(async () => ({ success: false, error: { code: 'DEPLOY_IN_PROGRESS' } }));

    const result = await fetchWithPreviewRetry(fetchFn, false);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((result as any).success).toBe(false);
  });

  it('returns immediately on success without retrying', async () => {
    const fetchFn = vi.fn(async () => ({ success: true, data: [1, 2, 3] }));

    const result = await fetchWithPreviewRetry(fetchFn, true);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((result as any).data).toEqual([1, 2, 3]);
  });

  it('returns immediately on a NON-retryable error code', async () => {
    const fetchFn = vi.fn(async () => ({ success: false, error: { code: 'VALIDATION_ERROR' } }));

    const result = await fetchWithPreviewRetry(fetchFn, true);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((result as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('retries DEPLOY_IN_PROGRESS with exponential backoff then succeeds', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n++;
      // First two attempts report deploy-in-progress, then success.
      return n < 3
        ? { success: false, error: { code: 'DEPLOY_IN_PROGRESS' } }
        : { success: true, data: 'ready' };
    });

    const promise = fetchWithPreviewRetry(fetchFn, true);

    // Attempt 0 runs synchronously (no leading delay).
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Backoff before attempt 1 = INITIAL_DELAY_MS * 2^0 = 2000ms.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // Backoff before attempt 2 = 2000 * 2^1 = 4000ms.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect((result as any).success).toBe(true);
    expect((result as any).data).toBe('ready');
  });

  it('also retries the APP_NOT_FOUND code', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n++;
      return n < 2
        ? { success: false, error: { code: 'APP_NOT_FOUND' } }
        : { success: true };
    });

    const promise = fetchWithPreviewRetry(fetchFn, true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);

    const result = await promise;
    expect((result as any).success).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up after MAX_RETRIES and returns the last (still-failing) result', async () => {
    const fetchFn = vi.fn(async () => ({ success: false, error: { code: 'DEPLOY_IN_PROGRESS' } }));

    const promise = fetchWithPreviewRetry(fetchFn, true);
    // Drain every backoff window (2s,4s,8s,16s) — run all pending timers.
    await vi.runAllTimersAsync();

    const result = await promise;
    // MAX_RETRIES = 4 → 1 initial + 4 retries = 5 total attempts.
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect((result as any).error.code).toBe('DEPLOY_IN_PROGRESS');
  });

  it('treats a result with no success flag as success (stops retrying)', async () => {
    // res.success !== false is true for a plain payload → returned as-is.
    const fetchFn = vi.fn(async () => ({ rows: [] }));

    const result = await fetchWithPreviewRetry(fetchFn, true);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((result as any).rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// colors — converters, luminance, contrast, parsing
// ---------------------------------------------------------------------------

describe('colors.hexToHsl', () => {
  it('converts a known dark slate hex to HSL', () => {
    expect(hexToHsl('#1a202c')).toBe('220 26% 14%');
  });

  it('expands 3-char shorthand', () => {
    // #fff → white → 0 0% 100%
    expect(hexToHsl('#fff')).toBe('0 0% 100%');
    // #f00 → pure red.
    expect(hexToHsl('#f00')).toBe('0 100% 50%');
  });

  it('handles hex without a leading #', () => {
    expect(hexToHsl('000000')).toBe('0 0% 0%');
  });

  it('returns a safe default for invalid lengths', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(hexToHsl('#12345')).toBe('0 0% 0%');
    expect(hexToHsl('zzzz')).toBe('0 0% 0%');
    spy.mockRestore();
  });
});

describe('colors.hexToRgb', () => {
  it('parses 6-char hex', () => {
    expect(hexToRgb('#FF8800')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('expands 3-char shorthand', () => {
    expect(hexToRgb('#0f0')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('strips alpha from 8-char hex', () => {
    expect(hexToRgb('#11223380')).toEqual({ r: 17, g: 34, b: 51 });
  });

  it('returns null for malformed input', () => {
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('')).toBeNull();
    expect(hexToRgb('not-a-color')).toBeNull();
  });
});

describe('colors.cssRgbToHex', () => {
  it('parses comma-separated rgb()', () => {
    expect(cssRgbToHex('rgb(199, 154, 154)')).toBe('#C79A9A');
  });

  it('parses space-separated rgb()', () => {
    expect(cssRgbToHex('rgb(255 100 50)')).toBe('#FF6432');
  });

  it('parses rgba() and ignores alpha', () => {
    expect(cssRgbToHex('rgba(255, 100, 50, 0.5)')).toBe('#FF6432');
  });

  it('clamps out-of-range channels into 0–255', () => {
    // 999 → 255, regex captures up to 3 digits so 999 is captured then clamped.
    expect(cssRgbToHex('rgb(999, 0, 0)')).toBe('#FF0000');
  });

  it('returns null for non-rgb strings', () => {
    expect(cssRgbToHex('#fff')).toBeNull();
    expect(cssRgbToHex('hsl(200,100%,50%)')).toBeNull();
  });
});

describe('colors.cssHslToHex', () => {
  it('parses comma-separated hsl()', () => {
    // hsl(0,100%,50%) → pure red.
    expect(cssHslToHex('hsl(0, 100%, 50%)')).toBe('#FF0000');
  });

  it('parses space-separated hsl()', () => {
    expect(cssHslToHex('hsl(120 100% 50%)')).toBe('#00FF00');
  });

  it('handles achromatic (0 saturation) greys', () => {
    expect(cssHslToHex('hsl(0, 0%, 50%)')).toBe('#808080');
  });

  it('parses hsla() with alpha (alpha ignored)', () => {
    expect(cssHslToHex('hsla(240, 100%, 50%, 0.3)')).toBe('#0000FF');
  });

  it('returns null for non-hsl strings', () => {
    expect(cssHslToHex('rgb(1,2,3)')).toBeNull();
  });
});

describe('colors.parseArbitraryColorValue', () => {
  it('passes through valid hex', () => {
    expect(parseArbitraryColorValue('#abc')).toBe('#abc');
    expect(parseArbitraryColorValue('  #AABBCC  ')).toBe('#AABBCC');
  });

  it('routes rgb()/hsl() to their converters', () => {
    expect(parseArbitraryColorValue('rgb(255, 100, 50)')).toBe('#FF6432');
    expect(parseArbitraryColorValue('hsl(0, 100%, 50%)')).toBe('#FF0000');
  });

  it('returns null for unsupported / malformed values', () => {
    expect(parseArbitraryColorValue('blue')).toBeNull();
    expect(parseArbitraryColorValue('#xyz')).toBeNull();
    expect(parseArbitraryColorValue('')).toBeNull();
  });
});

describe('colors luminance + contrast', () => {
  it('computes luminance bounds for black and white', () => {
    expect(getLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(getLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('yields the maximum 21:1 contrast for black vs white', () => {
    expect(getContrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('is symmetric regardless of argument order', () => {
    const a = getContrastRatio('#123456', '#abcdef');
    const b = getContrastRatio('#abcdef', '#123456');
    expect(a).toBeCloseTo(b, 10);
  });

  it('returns 1 when either color is invalid', () => {
    expect(getContrastRatio('not-a-color', '#FFFFFF')).toBe(1);
    expect(getContrastRatio('#FFFFFF', 'garbage')).toBe(1);
  });

  it('evaluates WCAG AA / AAA thresholds', () => {
    // Black on white clears both AA (4.5) and AAA (7).
    expect(meetsContrastRequirement('#000000', '#FFFFFF', 'AA')).toBe(true);
    expect(meetsContrastRequirement('#000000', '#FFFFFF', 'AAA')).toBe(true);
    // A low-contrast pair fails both.
    expect(meetsContrastRequirement('#777777', '#808080', 'AA')).toBe(false);
  });

  it('defaults to AA when no level given', () => {
    expect(meetsContrastRequirement('#000000', '#FFFFFF')).toBe(true);
  });
});

describe('colors.isDarkColor', () => {
  it('classifies pure black as dark and white as light', () => {
    expect(isDarkColor('#000000')).toBe(true);
    expect(isDarkColor('#FFFFFF')).toBe(false);
  });

  it('returns false for an invalid hex (cannot determine → not dark)', () => {
    expect(isDarkColor('nope')).toBe(false);
  });
});

describe('colors.getContrastingTextColor', () => {
  it('picks white text on a dark background', () => {
    expect(getContrastingTextColor('#1a202c')).toBe('#FFFFFF');
  });

  it('picks dark text on a light background', () => {
    // On white the darkest candidate (#000000) wins the contrast race.
    expect(getContrastingTextColor('#FFFFFF')).toBe('#000000');
  });

  it('falls back to black background handling for an invalid color', () => {
    // Invalid bg coerces to #000000 → white text is highest contrast.
    expect(getContrastingTextColor('garbage')).toBe('#FFFFFF');
  });
});
