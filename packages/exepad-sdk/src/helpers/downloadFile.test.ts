import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { downloadFile, downloadCsv } from './downloadFile';
import {
  useFileUpload,
  extractAppIdFromUrl,
  buildFileUrl,
  useFileUrl,
} from '../hooks/useFileUpload';

/**
 * The download helpers + useFileUpload ship verbatim into every generated app,
 * so they're tested here under happy-dom. Three concerns are load-bearing:
 *
 *  1. downloadCsv — RFC-4180-ish field escaping (commas, embedded quotes
 *     doubled, newlines), a UTF-8 BOM prefix so Excel renders non-ASCII, stable
 *     header ordering from the first row, and an empty-rows no-op.
 *  2. downloadFile — correct Blob construction + anchor wiring (createObjectURL
 *     → href/download → click → cleanup → deferred revoke), and SSR safety.
 *  3. useFileUpload — the XHR state machine across happy-path, HTTP error,
 *     network error and abort branches, plus progress reporting and appId
 *     resolution. XMLHttpRequest is stubbed so the branches are deterministic.
 */

// ── downloadFile / downloadCsv: anchor + URL instrumentation ─────────────

interface AnchorSpy {
  click: ReturnType<typeof vi.fn>;
  href: string;
  download: string;
  /** Live reference to the real anchor element so its style is observable. */
  el: HTMLElement;
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let createdBlobs: Blob[];
let lastAnchor: AnchorSpy | null;
let appendChildSpy: ReturnType<typeof vi.spyOn>;
let removeChildSpy: ReturnType<typeof vi.spyOn>;
let createElementSpy: ReturnType<typeof vi.spyOn>;

// The anchor + URL + fake-timer instrumentation is scoped to the download
// describes only (via installDownloadHarness) so it never leaks into the hook
// tests, which need real timers and an unspied document.createElement.
function installDownloadHarness(): void {
  beforeEach(() => {
    createdBlobs = [];
    lastAnchor = null;

    createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return `blob:mock/${createdBlobs.length}`;
    });
    revokeObjectURL = vi.fn();
    // happy-dom's URL.createObjectURL is a stub; override both so we can assert.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;

    // Intercept anchor creation so click()/href/download are observable, while
    // every other element is created for real (so appendChild/removeChild work).
    // Grab the original via the prototype so we never recurse into the spy.
    const realCreateElement = HTMLDocument.prototype.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(
      ((tag: string, opts?: ElementCreationOptions) => {
        const el = realCreateElement(tag, opts) as HTMLElement;
        if (tag === 'a') {
          const spy: AnchorSpy = {
            click: vi.fn(),
            href: '',
            download: '',
            el,
          };
          // Wire the anchor element so document.body.appendChild works on a real
          // node, but reads/writes of the relevant props land on the spy.
          Object.defineProperty(el, 'href', {
            get: () => spy.href,
            set: (v: string) => { spy.href = v; },
            configurable: true,
          });
          Object.defineProperty(el, 'download', {
            get: () => spy.download,
            set: (v: string) => { spy.download = v; },
            configurable: true,
          });
          (el as unknown as { click: () => void }).click = () => { spy.click(); };
          lastAnchor = spy;
        }
        return el;
      }) as typeof document.createElement,
    );

    appendChildSpy = vi.spyOn(document.body, 'appendChild');
    removeChildSpy = vi.spyOn(document.body, 'removeChild');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    vi.restoreAllMocks();
  });
}

describe('downloadFile — blob + anchor wiring', () => {
  installDownloadHarness();

  it('builds a Blob with the given mime type and the supplied string content', () => {
    downloadFile('report.txt', 'hello world', 'text/plain');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createdBlobs).toHaveLength(1);
    const blob = createdBlobs[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe(new Blob(['hello world']).size);
  });

  it('passes a Blob through unchanged rather than re-wrapping it', () => {
    const original = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    downloadFile('chart.svg', original, 'image/svg+xml');

    // The exact same Blob instance must reach createObjectURL (no copy).
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(original);
    expect(createdBlobs[0]).toBe(original);
  });

  it('wires the anchor href/download, attaches, clicks, then detaches it', () => {
    downloadFile('data.csv', 'a,b', 'text/csv');

    expect(lastAnchor).not.toBeNull();
    expect(lastAnchor!.href).toBe('blob:mock/1');
    expect(lastAnchor!.download).toBe('data.csv');
    // Hidden so it can never flash into layout.
    expect(lastAnchor!.el.style.display).toBe('none');
    expect(lastAnchor!.click).toHaveBeenCalledTimes(1);

    // Attach-before-click, detach-after-click ordering.
    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    expect(removeChildSpy).toHaveBeenCalledTimes(1);
    const appendOrder = appendChildSpy.mock.invocationCallOrder[0];
    const clickOrder = lastAnchor!.click.mock.invocationCallOrder[0];
    const removeOrder = removeChildSpy.mock.invocationCallOrder[0];
    expect(appendOrder).toBeLessThan(clickOrder);
    expect(clickOrder).toBeLessThan(removeOrder);
  });

  it('preserves the exact filename as the download attribute (no sanitization applied)', () => {
    // The helper does not rewrite the filename; whatever the caller passes is
    // surfaced verbatim on the anchor's download attribute.
    downloadFile('My Report (2026).csv', 'x', 'text/csv');
    expect(lastAnchor!.download).toBe('My Report (2026).csv');
  });

  it('defers revocation: URL is not revoked synchronously, but is after 30s', () => {
    downloadFile('data.csv', 'a,b', 'text/csv');

    // Revocation is scheduled, not immediate — the download stream must finish.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(29_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock/1');
  });

  it('is a no-op when URL is undefined (SSR / no-DOM guard)', () => {
    const savedURL = globalThis.URL;
    // Simulate an environment without the URL API.
    (globalThis as unknown as { URL: unknown }).URL = undefined;
    try {
      expect(() => downloadFile('x.txt', 'data', 'text/plain')).not.toThrow();
      // No anchor was created — the guard short-circuited before DOM work.
      expect(lastAnchor).toBeNull();
      expect(appendChildSpy).not.toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { URL: unknown }).URL = savedURL;
    }
  });
});

describe('downloadCsv — escaping, BOM, headers, no-op', () => {
  installDownloadHarness();

  // Helper: decode the Blob text that downloadCsv handed to downloadFile.
  async function capturedCsvText(): Promise<string> {
    expect(createdBlobs).toHaveLength(1);
    return await createdBlobs[0].text();
  }

  it('emits a header row from the first row keys, then one row per record', async () => {
    downloadCsv('users.csv', [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    const text = await capturedCsvText();
    // Strip the BOM for the structural assertion.
    const body = text.replace(/^﻿/, '');
    expect(body).toBe('id,name\r\n1,Alice\r\n2,Bob');
  });

  it('prefixes the output with a UTF-8 BOM so Excel renders non-ASCII', async () => {
    downloadCsv('u.csv', [{ name: '世界' }]);
    const text = await capturedCsvText();
    // U+FEFF must be the very first character.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.startsWith('﻿name\r\n世界')).toBe(true);
  });

  it('uses the supplied csv mime type with charset', async () => {
    downloadCsv('u.csv', [{ a: 1 }]);
    expect(createdBlobs[0].type).toBe('text/csv;charset=utf-8');
    expect(lastAnchor!.download).toBe('u.csv');
  });

  it('quotes a value containing a comma and leaves clean values bare', async () => {
    downloadCsv('u.csv', [{ name: 'Doe, John', city: 'Paris' }]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    expect(body).toBe('name,city\r\n"Doe, John",Paris');
  });

  it('doubles embedded double-quotes and wraps the field in quotes', async () => {
    downloadCsv('u.csv', [{ note: 'He said "hi"' }]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    // " → "" and the whole field quoted.
    expect(body).toBe('note\r\n"He said ""hi"""');
  });

  it('quotes fields containing newlines and carriage returns', async () => {
    downloadCsv('u.csv', [{ note: 'line1\nline2' }, { note: 'a\r\nb' }]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    // Row separator is \r\n; the embedded newlines stay inside quoted fields.
    expect(body).toBe('note\r\n"line1\nline2"\r\n"a\r\nb"');
  });

  it('renders null and undefined values as empty strings', async () => {
    downloadCsv('u.csv', [{ a: null, b: undefined, c: 0, d: '' }]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    // null/undefined → '', numeric 0 is kept (not blanked), empty string stays empty.
    expect(body).toBe('a,b,c,d\r\n,,0,');
  });

  it('stringifies non-string scalars (numbers, booleans)', async () => {
    downloadCsv('u.csv', [{ n: 42, ok: true, no: false }]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    expect(body).toBe('n,ok,no\r\n42,true,false');
  });

  it('locks header order + column set to the FIRST row, ignoring extra keys in later rows', async () => {
    downloadCsv('u.csv', [
      { id: 1, name: 'Alice' },
      // `extra` is not a header from row 0, so it is dropped; `name` missing → blank.
      { id: 2, extra: 'ignored' },
    ]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    expect(body).toBe('id,name\r\n1,Alice\r\n2,');
  });

  it('preserves insertion order of the first row keys as the header order', async () => {
    downloadCsv('u.csv', [{ z: 1, a: 2, m: 3 }]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    expect(body.split('\r\n')[0]).toBe('z,a,m');
  });

  it('is a strict no-op for an empty rows array (no zero-row file)', () => {
    downloadCsv('empty.csv', []);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(appendChildSpy).not.toHaveBeenCalled();
    expect(lastAnchor).toBeNull();
  });

  it('does not treat a value that merely contains a quote-free space as needing quoting', async () => {
    // Spaces alone are not special in CSV; only [",\n\r] trigger quoting.
    downloadCsv('u.csv', [{ name: 'Alice Smith' }]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    expect(body).toBe('name\r\nAlice Smith');
  });

  it('does not let a comma in a value forge an extra column (injection-style payload)', async () => {
    // A value engineered to look like two columns must stay one quoted field.
    downloadCsv('u.csv', [{ name: 'evil', payload: 'a,b,c' }]);
    const body = (await capturedCsvText()).replace(/^﻿/, '');
    const rows = body.split('\r\n');
    expect(rows[0]).toBe('name,payload');
    expect(rows[1]).toBe('evil,"a,b,c"');
  });
});

// ── useFileUpload: XHR state machine ─────────────────────────────────────

/**
 * A controllable XMLHttpRequest stub. The hook adds load/error/abort listeners
 * and an upload.progress listener, then calls open()/send(). Tests drive the
 * lifecycle by calling the captured listeners via the helper methods.
 */
class FakeXHR {
  static instances: FakeXHR[] = [];

  status = 0;
  responseText = '';
  method = '';
  url = '';
  sent: unknown = undefined;
  aborted = false;

  upload = {
    listeners: {} as Record<string, (e: unknown) => void>,
    addEventListener: (type: string, cb: (e: unknown) => void) => {
      this.upload.listeners[type] = cb;
    },
  };

  private listeners: Record<string, () => void> = {};

  constructor() {
    FakeXHR.instances.push(this);
  }

  addEventListener(type: string, cb: () => void): void {
    this.listeners[type] = cb;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(body: unknown): void {
    this.sent = body;
  }

  abort(): void {
    this.aborted = true;
    this.listeners.abort?.();
  }

  // ── test drivers ──
  fireProgress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.listeners.progress?.({ loaded, total, lengthComputable });
  }
  fireLoad(status: number, responseText: string): void {
    this.status = status;
    this.responseText = responseText;
    this.listeners.load?.();
  }
  fireError(): void {
    this.listeners.error?.();
  }

  static last(): FakeXHR {
    return FakeXHR.instances[FakeXHR.instances.length - 1];
  }
}

function makeFile(name = 'photo.png', content = 'binary'): File {
  return new File([content], name, { type: 'image/png' });
}

describe('useFileUpload — XHR state machine', () => {
  let savedXHR: typeof XMLHttpRequest;

  beforeEach(() => {
    // The download-block's fake timers + element spies are restored in its own
    // afterEach; here we only need real timers for promise resolution.
    vi.useRealTimers();
    FakeXHR.instances = [];
    savedXHR = globalThis.XMLHttpRequest;
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
      FakeXHR as unknown as typeof XMLHttpRequest;
  });

  afterEach(() => {
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = savedXHR;
  });

  it('starts idle: progress 0, not uploading, no error', () => {
    const { result } = renderHook(() => useFileUpload());
    expect(result.current.progress).toBe(0);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('resolves with file metadata and reports 100% on a 2xx success envelope', async () => {
    const { result } = renderHook(() => useFileUpload({ appId: 'app42' }));

    const meta = {
      id: 'f1',
      url: '/api/app42/_files/f1/photo.png',
      filename: 'photo.png',
      contentType: 'image/png',
      size: 6,
      visibility: 'private',
      createdAt: '2026-06-20T00:00:00Z',
    };

    let promise: Promise<unknown>;
    act(() => {
      promise = result.current.upload(makeFile());
    });

    // The upload is now in flight.
    await waitFor(() => expect(result.current.isUploading).toBe(true));
    expect(FakeXHR.last().method).toBe('POST');
    expect(FakeXHR.last().url).toBe('/api/app42/_files/upload');
    expect(FakeXHR.last().sent).toBeInstanceOf(FormData);

    act(() => {
      FakeXHR.last().fireLoad(200, JSON.stringify({ success: true, data: meta }));
    });

    await expect(promise!).resolves.toEqual(meta);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(100);
    expect(result.current.error).toBeNull();
  });

  it('tracks upload progress from lengthComputable events', async () => {
    const { result } = renderHook(() => useFileUpload());

    act(() => { void result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => { FakeXHR.last().fireProgress(50, 200); });
    await waitFor(() => expect(result.current.progress).toBe(25));

    act(() => { FakeXHR.last().fireProgress(200, 200); });
    await waitFor(() => expect(result.current.progress).toBe(100));
  });

  it('ignores progress events that are not lengthComputable', async () => {
    const { result } = renderHook(() => useFileUpload());
    act(() => { void result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => { FakeXHR.last().fireProgress(50, 0, false); });
    // progress stays at its reset value, no division-by-zero artifact.
    expect(result.current.progress).toBe(0);
  });

  it('appends optional metadata fields to the FormData when provided', async () => {
    const { result } = renderHook(() =>
      useFileUpload({
        appId: 'app42',
        visibility: 'public',
        modelName: 'photos',
        recordId: 'rec1',
        fieldName: 'avatar',
      }),
    );
    act(() => { void result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    const fd = FakeXHR.last().sent as FormData;
    expect(fd.get('visibility')).toBe('public');
    expect(fd.get('model_name')).toBe('photos');
    expect(fd.get('record_id')).toBe('rec1');
    expect(fd.get('field_name')).toBe('avatar');
    expect(fd.get('file')).toBeInstanceOf(File);
  });

  it('omits optional FormData fields that were not configured', async () => {
    const { result } = renderHook(() => useFileUpload({ appId: 'app42' }));
    act(() => { void result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    const fd = FakeXHR.last().sent as FormData;
    expect(fd.has('visibility')).toBe(false);
    expect(fd.has('model_name')).toBe(false);
    expect(fd.has('record_id')).toBe(false);
    expect(fd.has('field_name')).toBe(false);
  });

  it('rejects + surfaces the server error message on a 2xx with success:false', async () => {
    const { result } = renderHook(() => useFileUpload());
    let promise: Promise<unknown>;
    act(() => { promise = result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => {
      FakeXHR.last().fireLoad(
        200,
        JSON.stringify({ success: false, error: { message: 'File too large' } }),
      );
    });

    await expect(promise!).rejects.toThrow('File too large');
    expect(result.current.error).toBe('File too large');
    expect(result.current.isUploading).toBe(false);
  });

  it('rejects with a generic message when a 2xx body lacks a usable error', async () => {
    const { result } = renderHook(() => useFileUpload());
    let promise: Promise<unknown>;
    act(() => { promise = result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => { FakeXHR.last().fireLoad(200, JSON.stringify({ success: false })); });

    await expect(promise!).rejects.toThrow('Upload failed');
    expect(result.current.error).toBe('Upload failed');
  });

  it('rejects with "Invalid response from server" on unparseable 2xx JSON', async () => {
    const { result } = renderHook(() => useFileUpload());
    let promise: Promise<unknown>;
    act(() => { promise = result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => { FakeXHR.last().fireLoad(200, '<html>not json</html>'); });

    await expect(promise!).rejects.toThrow('Invalid response from server');
    expect(result.current.error).toBe('Invalid response from server');
    expect(result.current.isUploading).toBe(false);
  });

  it('rejects with the parsed message on a non-2xx status', async () => {
    const { result } = renderHook(() => useFileUpload());
    let promise: Promise<unknown>;
    act(() => { promise = result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => {
      FakeXHR.last().fireLoad(
        413,
        JSON.stringify({ error: { message: 'Payload too large' } }),
      );
    });

    await expect(promise!).rejects.toThrow('Payload too large');
    expect(result.current.error).toBe('Payload too large');
  });

  it('falls back to "Upload failed (status)" on a non-2xx with non-JSON body', async () => {
    const { result } = renderHook(() => useFileUpload());
    let promise: Promise<unknown>;
    act(() => { promise = result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => { FakeXHR.last().fireLoad(500, 'Internal Server Error'); });

    await expect(promise!).rejects.toThrow('Upload failed (500)');
    expect(result.current.error).toBe('Upload failed (500)');
  });

  it('rejects with a network-error message on the xhr error event', async () => {
    const { result } = renderHook(() => useFileUpload());
    let promise: Promise<unknown>;
    act(() => { promise = result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    act(() => { FakeXHR.last().fireError(); });

    await expect(promise!).rejects.toThrow('Network error during upload');
    expect(result.current.error).toBe('Network error during upload');
    expect(result.current.isUploading).toBe(false);
  });

  it('cancel() aborts the in-flight xhr, resets progress, and rejects with "Upload cancelled"', async () => {
    const { result } = renderHook(() => useFileUpload());
    let promise: Promise<unknown>;
    act(() => { promise = result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));

    // Push some progress so we can prove cancel resets it to 0.
    act(() => { FakeXHR.last().fireProgress(50, 100); });
    await waitFor(() => expect(result.current.progress).toBe(50));

    const xhr = FakeXHR.last();
    act(() => { result.current.cancel(); });

    expect(xhr.aborted).toBe(true);
    await expect(promise!).rejects.toThrow('Upload cancelled');
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBe('Upload cancelled');
  });

  it('cancel() is a no-op when nothing is in flight', () => {
    const { result } = renderHook(() => useFileUpload());
    expect(() => act(() => { result.current.cancel(); })).not.toThrow();
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it('resets error + progress at the start of a subsequent upload', async () => {
    const { result } = renderHook(() => useFileUpload());

    // First upload fails.
    let p1: Promise<unknown>;
    act(() => { p1 = result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));
    act(() => { FakeXHR.last().fireError(); });
    await expect(p1!).rejects.toThrow();
    expect(result.current.error).toBe('Network error during upload');

    // Second upload must clear the prior error immediately on start.
    act(() => { void result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBe(0);
  });

  it('falls back to the default "app" appId when none is supplied and URL has no match', async () => {
    // happy-dom's default location pathname does not match the app-url regex.
    const { result } = renderHook(() => useFileUpload());
    act(() => { void result.current.upload(makeFile()); });
    await waitFor(() => expect(result.current.isUploading).toBe(true));
    expect(FakeXHR.last().url).toBe('/api/app/_files/upload');
  });
});

// ── pure URL helpers ─────────────────────────────────────────────────────

describe('extractAppIdFromUrl', () => {
  let realLocation: Location;
  beforeEach(() => { realLocation = window.location; });
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: realLocation, writable: true, configurable: true,
    });
  });

  function setPath(pathname: string): void {
    Object.defineProperty(window, 'location', {
      value: { pathname }, writable: true, configurable: true,
    });
  }

  it('extracts the id from an /example/{id} path', () => {
    setPath('/example/abc123/page');
    expect(extractAppIdFromUrl()).toBe('abc123');
  });

  it('extracts the id from an /a/{id} path', () => {
    setPath('/a/app99/posts');
    expect(extractAppIdFromUrl()).toBe('app99');
  });

  it('extracts the id from a /demo/{id} path', () => {
    setPath('/demo/demo7');
    expect(extractAppIdFromUrl()).toBe('demo7');
  });

  it('returns null for an unrecognized path', () => {
    setPath('/something/else');
    expect(extractAppIdFromUrl()).toBeNull();
  });
});

describe('buildFileUrl', () => {
  it('builds a file-serving URL and encodes the filename', () => {
    expect(buildFileUrl('app1', 'file9', 'my report.pdf')).toBe(
      '/api/app1/_files/file9/my%20report.pdf',
    );
  });

  it('defaults the filename to "file" when omitted', () => {
    expect(buildFileUrl('app1', 'file9')).toBe('/api/app1/_files/file9/file');
  });

  it('percent-encodes traversal/special characters in the filename segment', () => {
    // A "../" in the name must not escape the path segment — encodeURIComponent
    // turns the slashes into %2F so it stays one segment.
    expect(buildFileUrl('app1', 'f', '../../etc/passwd')).toBe(
      '/api/app1/_files/f/..%2F..%2Fetc%2Fpasswd',
    );
  });
});

describe('useFileUrl', () => {
  it('memoizes the built URL and recomputes when inputs change', () => {
    const { result, rerender } = renderHook(
      ({ a, f, n }) => useFileUrl(a, f, n),
      { initialProps: { a: 'app1', f: 'file1', n: 'a.png' } },
    );
    const first = result.current;
    expect(first).toBe('/api/app1/_files/file1/a.png');

    // Same inputs → same memoized reference.
    rerender({ a: 'app1', f: 'file1', n: 'a.png' });
    expect(result.current).toBe(first);

    // Changed input → recomputed value.
    rerender({ a: 'app1', f: 'file2', n: 'a.png' });
    expect(result.current).toBe('/api/app1/_files/file2/a.png');
  });
});
