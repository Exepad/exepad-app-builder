import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractImageUrls, captureAndRewriteImages } from '../../../worker/src/lib/image-capture';

// ---------------------------------------------------------------------------
// Mock R2Bucket
// ---------------------------------------------------------------------------

function createMockR2Bucket(files: Record<string, string> = {}) {
  const stored: Record<string, string | ArrayBuffer> = { ...files };
  return {
    get: vi.fn(async (key: string) => {
      const content = stored[key];
      if (!content) return null;
      const text = typeof content === 'string' ? content : new TextDecoder().decode(new Uint8Array(content as ArrayBuffer));
      return {
        text: async () => text,
        json: async () => JSON.parse(text),
        arrayBuffer: async () =>
          typeof content === 'string'
            ? new TextEncoder().encode(content).buffer
            : content,
        body: new ReadableStream(),
      };
    }),
    put: vi.fn(async (key: string, value: any) => {
      stored[key] = typeof value === 'string' ? value : 'binary';
    }),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ objects: [], truncated: false, delimitedPrefixes: [] })),
    head: vi.fn(async (key: string) =>
      stored[key] ? { key, size: typeof stored[key] === 'string' ? (stored[key] as string).length : 0 } : null,
    ),
  } as unknown as R2Bucket;
}

// ---------------------------------------------------------------------------
// extractImageUrls
// ---------------------------------------------------------------------------

describe('extractImageUrls', () => {
  it('finds image URLs in nested config', () => {
    const config = {
      pages: [
        {
          components: [
            { type: 'Image', props: { src: 'https://example.com/photo.jpg' } },
          ],
        },
      ],
    };
    const map = extractImageUrls(config);
    expect(map.has('https://example.com/photo.jpg')).toBe(true);
  });

  it('finds URLs in theme and metadata fields', () => {
    const config = {
      theme: {
        logoUrl: 'https://example.com/logo.png',
      },
      metadata: {
        ogImage: 'https://example.com/og.webp',
      },
    };
    const map = extractImageUrls(config);
    expect(map.has('https://example.com/logo.png')).toBe(true);
    expect(map.has('https://example.com/og.webp')).toBe(true);
  });

  it('skips data URIs', () => {
    const config = { img: 'data:image/png;base64,abc123' };
    const map = extractImageUrls(config);
    expect(map.size).toBe(0);
  });

  it('skips blob URIs', () => {
    const config = { img: 'blob:http://localhost/abc' };
    const map = extractImageUrls(config);
    expect(map.size).toBe(0);
  });

  it('skips already-captured R2 URLs containing /published/assets/', () => {
    const config = { img: 'https://r2.example.com/published/assets/img_abc123.jpg' };
    const map = extractImageUrls(config);
    expect(map.size).toBe(0);
  });

  it('skips relative paths (not http/https)', () => {
    const config = { img: '/images/logo.png' };
    const map = extractImageUrls(config);
    expect(map.size).toBe(0);
  });

  it('detects common image extensions (.jpg, .png, .webp, .gif)', () => {
    const config = {
      a: 'https://cdn.example.com/pic.jpg',
      b: 'https://cdn.example.com/icon.png',
      c: 'https://cdn.example.com/hero.webp',
      d: 'https://cdn.example.com/anim.gif',
    };
    const map = extractImageUrls(config);
    expect(map.size).toBe(4);
  });

  it('detects known image hosts (unsplash, pexels)', () => {
    const config = {
      a: 'https://images.unsplash.com/photo-123?w=800',
      b: 'https://images.pexels.com/photos/456/pexels-photo-456.jpeg',
    };
    const map = extractImageUrls(config);
    expect(map.size).toBe(2);
  });

  it('returns Map with JSON paths showing where URLs appear', () => {
    const config = {
      pages: [
        {
          hero: { src: 'https://example.com/hero.png' },
        },
      ],
    };
    const map = extractImageUrls(config);
    const paths = map.get('https://example.com/hero.png');
    expect(paths).toBeDefined();
    expect(paths![0]).toBe('pages[0].hero.src');
  });

  it('groups duplicate URLs under the same key with multiple paths', () => {
    const url = 'https://example.com/shared.png';
    const config = {
      header: { logo: url },
      footer: { logo: url },
    };
    const map = extractImageUrls(config);
    expect(map.size).toBe(1);
    expect(map.get(url)!.length).toBe(2);
  });

  it('handles null and undefined values without crashing', () => {
    const config = {
      a: null,
      b: undefined,
      c: { nested: null },
    };
    const map = extractImageUrls(config as any);
    expect(map.size).toBe(0);
  });

  it('handles arrays with mixed types', () => {
    const config = {
      items: [
        'https://example.com/img1.png',
        42,
        null,
        { url: 'https://example.com/img2.jpg' },
      ],
    };
    const map = extractImageUrls(config);
    expect(map.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// captureAndRewriteImages
// ---------------------------------------------------------------------------

describe('captureAndRewriteImages', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function stubFetch(responses: Record<string, { body: Uint8Array; contentType: string; status?: number }>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        const entry = responses[urlStr];
        if (!entry) return new Response(null, { status: 404, statusText: 'Not Found' });
        return new Response(entry.body, {
          status: entry.status ?? 200,
          headers: {
            'content-type': entry.contentType,
            'content-length': String(entry.body.byteLength),
          },
        });
      }),
    );
  }

  const smallPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('downloads image, hashes content, uploads to R2', async () => {
    const r2 = createMockR2Bucket();
    stubFetch({
      'https://example.com/photo.png': { body: smallPng, contentType: 'image/png' },
    });

    const config = { hero: { src: 'https://example.com/photo.png' } };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    expect(result.captured.length).toBe(1);
    expect(result.failed.length).toBe(0);
    expect(result.captured[0].originalUrl).toBe('https://example.com/photo.png');
    expect(result.captured[0].r2Key).toMatch(/^app1\/published\/assets\/img_[a-f0-9]+\.png$/);
    expect(result.captured[0].contentType).toBe('image/png');
    expect(r2.put).toHaveBeenCalled();
  });

  it('generates r2Url as relative path (no appId prefix)', async () => {
    const r2 = createMockR2Bucket();
    stubFetch({
      'https://example.com/photo.png': { body: smallPng, contentType: 'image/png' },
    });

    const config = { img: 'https://example.com/photo.png' };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    expect(result.captured[0].r2Url).toMatch(/^\/published\/assets\/img_[a-f0-9]+\.png$/);
  });

  it('deduplicates: same URL twice produces single R2 file', async () => {
    const r2 = createMockR2Bucket();
    stubFetch({
      'https://example.com/logo.jpg': { body: smallPng, contentType: 'image/jpeg' },
    });

    const config = {
      header: { logo: 'https://example.com/logo.jpg' },
      footer: { logo: 'https://example.com/logo.jpg' },
    };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    expect(result.captured.length).toBe(1);
    // Both places should be rewritten
    expect(result.rewrittenConfig).toHaveProperty('header.logo');
    expect(result.rewrittenConfig).toHaveProperty('footer.logo');
    const rewritten = result.rewrittenConfig as any;
    expect(rewritten.header.logo).toBe(rewritten.footer.logo);
    expect(rewritten.header.logo).toMatch(/^\/published\/assets\/img_/);
  });

  it('skips images > 5MB (based on content-length header)', async () => {
    const r2 = createMockR2Bucket();
    const bigBody = new Uint8Array(10);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(bigBody, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(6 * 1024 * 1024), // 6 MB
          },
        }),
      ),
    );

    const config = { img: 'https://example.com/huge.png' };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    // captureOneImage returns null for oversized images, which goes to failed
    expect(result.captured.length).toBe(0);
    expect(result.failed.length).toBe(1);
  });

  it('handles fetch timeout (aborted signal)', async () => {
    const r2 = createMockR2Bucket();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );

    const config = { img: 'https://example.com/slow.jpg' };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    expect(result.captured.length).toBe(0);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].url).toBe('https://example.com/slow.jpg');
  });

  it('rewrites URLs in returned config', async () => {
    const r2 = createMockR2Bucket();
    stubFetch({
      'https://example.com/img.webp': { body: smallPng, contentType: 'image/webp' },
    });

    const config = {
      nested: { deep: { src: 'https://example.com/img.webp' } },
      plain: 'not-a-url',
    };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    const rewritten = result.rewrittenConfig as any;
    expect(rewritten.nested.deep.src).toMatch(/^\/published\/assets\/img_/);
    expect(rewritten.plain).toBe('not-a-url');
  });

  it('processes in batches with max 10 parallel downloads', async () => {
    const r2 = createMockR2Bucket();
    // Create 15 unique image URLs
    const config: Record<string, string> = {};
    const responses: Record<string, { body: Uint8Array; contentType: string }> = {};
    for (let i = 0; i < 15; i++) {
      const url = `https://example.com/img${i}.png`;
      config[`img${i}`] = url;
      responses[url] = { body: new Uint8Array([i, i + 1, i + 2]), contentType: 'image/png' };
    }
    stubFetch(responses);

    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    expect(result.captured.length).toBe(15);
    expect(result.failed.length).toBe(0);
  });

  it('records failed downloads while proceeding with others', async () => {
    const r2 = createMockR2Bucket();
    stubFetch({
      'https://example.com/good.png': { body: smallPng, contentType: 'image/png' },
      'https://example.com/bad.png': { body: smallPng, contentType: 'image/png', status: 500 },
    });

    const config = {
      a: 'https://example.com/good.png',
      b: 'https://example.com/bad.png',
    };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    expect(result.captured.length).toBe(1);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].url).toBe('https://example.com/bad.png');
  });

  it('returns original config when no image URLs found', async () => {
    const r2 = createMockR2Bucket();
    const config = { title: 'Hello', count: 42 };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    expect(result.captured.length).toBe(0);
    expect(result.failed.length).toBe(0);
    expect(result.rewrittenConfig).toEqual(config);
  });

  it('sets immutable cache-control on uploaded images', async () => {
    const r2 = createMockR2Bucket();
    stubFetch({
      'https://example.com/photo.png': { body: smallPng, contentType: 'image/png' },
    });

    const config = { img: 'https://example.com/photo.png' };
    await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    const putCall = (r2.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[2]).toEqual({
      httpMetadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  });

  it('uses content-type header to determine file extension', async () => {
    const r2 = createMockR2Bucket();
    stubFetch({
      'https://images.unsplash.com/photo-123?w=800': { body: smallPng, contentType: 'image/webp' },
    });

    const config = { img: 'https://images.unsplash.com/photo-123?w=800' };
    const result = await captureAndRewriteImages(r2 as unknown as R2Bucket, 'app1', config);

    expect(result.captured[0].r2Key).toMatch(/\.webp$/);
  });
});
