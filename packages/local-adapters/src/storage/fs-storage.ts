/**
 * FsStorageAdapter — a Cloudflare R2 (`R2Bucket`) compatible object store over
 * the local filesystem, for the self-hosted single-container runtime.
 *
 * Backs `CONFIG_CACHE` (app configs, snapshots, compiled component/handler JS)
 * and the per-app files bucket. Keys keep the EXACT existing scheme
 * (`{appId}/published/...`, `{appId}/{configPath}`, `_system/...`) and map to
 * paths under `<root>/{key}` (slashes → subdirectories). Object metadata
 * (contentType, content-hash etag, customMetadata) lives in a sibling
 * `<path>.exemeta` JSON sidecar; sidecars are filtered out of `list()`.
 *
 * Implements the subset the codebase uses: get/head/put/delete/list, and the
 * returned object's text()/json()/arrayBuffer()/body/etag/httpMetadata/size/
 * writeHttpMetadata().
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const META_SUFFIX = '.exemeta';
// Marker embedded in the names of in-flight temp files written by put(). Any
// on-disk name containing it is transient and must never be surfaced by list().
const TMP_MARKER = '.tmp-';
// Monotonic uniquifier so concurrent put()s in the same process never collide.
let tmpCounter = 0;

export interface HttpMetadata {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
}

interface SidecarMeta {
  etag: string;
  size: number;
  uploaded: string;
  httpMetadata?: HttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface PutOptions {
  httpMetadata?: HttpMetadata;
  customMetadata?: Record<string, string>;
}

export interface ListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
  delimiter?: string;
}

export interface R2ObjectMeta {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: HttpMetadata;
  customMetadata?: Record<string, string>;
  writeHttpMetadata(headers: Headers): void;
}

export interface R2ObjectBody extends R2ObjectMeta {
  body: ReadableStream;
  bodyUsed: boolean;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Objects {
  objects: R2ObjectMeta[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

function sanitizeKey(key: string): string {
  // Reject path traversal; keys are forward-slash, map to OS separators.
  if (key.includes('..')) throw new Error(`Invalid storage key: ${key}`);
  return key.replace(/^\/+/, '');
}

async function toBuffer(
  value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob,
): Promise<Buffer> {
  if (typeof value === 'string') return Buffer.from(value, 'utf-8');
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return Buffer.from(await value.arrayBuffer());
  }
  // Web ReadableStream
  const chunks: Buffer[] = [];
  for await (const chunk of Readable.fromWeb(value as never)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class FsStorageAdapter {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(process.env.EXEPAD_DATA_DIR ?? '/data', 'storage');
    mkdirSync(this.root, { recursive: true });
  }

  private pathFor(key: string): string {
    return join(this.root, sanitizeKey(key));
  }

  private readMeta(filePath: string): SidecarMeta | null {
    const metaPath = filePath + META_SUFFIX;
    if (!existsSync(metaPath)) return null;
    try {
      return JSON.parse(readFileSync(metaPath, 'utf-8')) as SidecarMeta;
    } catch {
      return null;
    }
  }

  private buildObjectMeta(key: string, filePath: string): R2ObjectMeta {
    const stat = statSync(filePath);
    let meta = this.readMeta(filePath);
    if (!meta) {
      // Legacy/externally-written file with no sidecar: derive a stable etag.
      const etag = createHash('sha256').update(readFileSync(filePath)).digest('hex');
      meta = { etag, size: stat.size, uploaded: stat.mtime.toISOString() };
    }
    const httpMetadata = meta.httpMetadata;
    return {
      key,
      size: meta.size ?? stat.size,
      etag: meta.etag,
      httpEtag: `"${meta.etag}"`,
      uploaded: new Date(meta.uploaded ?? stat.mtime.toISOString()),
      httpMetadata,
      customMetadata: meta.customMetadata,
      writeHttpMetadata(headers: Headers) {
        if (httpMetadata?.contentType) headers.set('content-type', httpMetadata.contentType);
        if (httpMetadata?.cacheControl) headers.set('cache-control', httpMetadata.cacheControl);
        if (httpMetadata?.contentDisposition)
          headers.set('content-disposition', httpMetadata.contentDisposition);
      },
    };
  }

  async head(key: string): Promise<R2ObjectMeta | null> {
    const filePath = this.pathFor(key);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;
    return this.buildObjectMeta(key, filePath);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const filePath = this.pathFor(key);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;
    const base = this.buildObjectMeta(key, filePath);
    return {
      ...base,
      bodyUsed: false,
      get body(): ReadableStream {
        // Cast through unknown: node's stream/web ReadableStream and the
        // DOM/workers-types ReadableStream don't structurally overlap, and this
        // file is compiled under both type environments (local-adapters: node;
        // deploy-utils: + @cloudflare/workers-types).
        return Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
      },
      async arrayBuffer(): Promise<ArrayBuffer> {
        const b = readFileSync(filePath);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
      async text(): Promise<string> {
        return readFileSync(filePath, 'utf-8');
      },
      async json<T = unknown>(): Promise<T> {
        return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
      },
    };
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob,
    options?: PutOptions,
  ): Promise<R2ObjectMeta> {
    const filePath = this.pathFor(key);
    mkdirSync(dirname(filePath), { recursive: true });
    const buf = await toBuffer(value);
    const etag = createHash('sha256').update(buf).digest('hex');
    const meta: SidecarMeta = {
      etag,
      size: buf.byteLength,
      uploaded: new Date().toISOString(),
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    };
    // Atomic write: stage both the object and its sidecar to unique temp files,
    // then rename into place. Rename the sidecar FIRST so that a completed
    // object rename always implies its metadata is already present (readers
    // never observe an object without its meta).
    const uniq = `${process.pid.toString(36)}-${(tmpCounter++).toString(36)}-${Date.now().toString(36)}`;
    const tmpObj = `${filePath}${TMP_MARKER}${uniq}`;
    const tmpMeta = `${filePath}${META_SUFFIX}${TMP_MARKER}${uniq}`;
    try {
      writeFileSync(tmpObj, buf);
      writeFileSync(tmpMeta, JSON.stringify(meta));
      renameSync(tmpMeta, filePath + META_SUFFIX);
      renameSync(tmpObj, filePath);
    } finally {
      // Best-effort cleanup of any temp files left behind by a failed rename.
      rmSync(tmpObj, { force: true });
      rmSync(tmpMeta, { force: true });
    }
    return this.buildObjectMeta(key, filePath);
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      const filePath = this.pathFor(k);
      rmSync(filePath, { force: true });
      rmSync(filePath + META_SUFFIX, { force: true });
    }
  }

  /** Delete an entire prefix subtree (used by deprovision; not part of R2's API). */
  async deletePrefix(prefix: string): Promise<void> {
    const dir = this.pathFor(prefix);
    // Guard the storage root. An empty / "/" / all-slashes prefix sanitizes to
    // "" and join(root, "") === root, so rmSync(root, { recursive: true })
    // would wipe EVERY app's bucket. deletePrefix is a per-app deprovision op —
    // a prefix that resolves to the root itself is always a caller bug (e.g. an
    // empty-string appId producing `${appId}/` === "/"); no-op rather than
    // destroy the whole store. `resolve()` also collapses "." / "./" to root.
    if (resolve(dir) === resolve(this.root)) return;
    rmSync(dir, { recursive: true, force: true });
  }

  async list(options?: ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const cursor = options?.cursor;
    const delimiter = options?.delimiter;

    // Only walk the subtree that could contain the prefix: start from the
    // closest existing ancestor directory (the prefix up to its last '/'),
    // never the entire storage root.
    const lastSlash = prefix.lastIndexOf('/');
    const baseDir = lastSlash >= 0 ? prefix.slice(0, lastSlash + 1) : '';
    if (baseDir.includes('..')) throw new Error(`Invalid list prefix: ${prefix}`);

    const allKeys: string[] = [];
    const walk = (absDir: string) => {
      let entries: Dirent[];
      try {
        // withFileTypes avoids a statSync per entry on the common path.
        entries = readdirSync(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const name = ent.name;
        // Skip metadata sidecars and in-flight temp files from put().
        if (name.endsWith(META_SUFFIX) || name.includes(TMP_MARKER)) continue;
        const abs = join(absDir, name);
        let isDir = ent.isDirectory();
        let isFile = ent.isFile();
        if (ent.isSymbolicLink()) {
          // Resolve symlinks defensively; drop dangling links.
          try {
            const st = statSync(abs);
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch {
            continue;
          }
        }
        if (isDir) {
          walk(abs);
        } else if (isFile) {
          const key = relative(this.root, abs).split(sep).join('/');
          if (key.startsWith(prefix)) allKeys.push(key);
        }
      }
    };
    walk(join(this.root, baseDir));
    allKeys.sort();

    // R2 delimiter semantics: keys whose remainder after `prefix` contains the
    // delimiter collapse into a shared `delimitedPrefixes` entry (up to and
    // including the first delimiter) and are omitted from `objects`.
    const delimitedPrefixes: string[] = [];
    let objectKeys = allKeys;
    if (delimiter) {
      const prefixSet = new Set<string>();
      const kept: string[] = [];
      for (const key of allKeys) {
        const rest = key.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx >= 0) {
          prefixSet.add(prefix + rest.slice(0, idx + delimiter.length));
        } else {
          kept.push(key);
        }
      }
      objectKeys = kept;
      delimitedPrefixes.push(...[...prefixSet].sort());
    }

    const startIdx = cursor ? objectKeys.findIndex((k) => k > cursor) : 0;
    const sliceKeys = startIdx < 0 ? [] : objectKeys.slice(startIdx, startIdx + limit);
    const truncated = startIdx >= 0 && startIdx + limit < objectKeys.length;
    const objects: R2ObjectMeta[] = [];
    for (const k of sliceKeys) {
      try {
        objects.push(this.buildObjectMeta(k, this.pathFor(k)));
      } catch {
        // The file vanished between the walk and the metadata build; skip it.
      }
    }

    return {
      objects,
      truncated,
      cursor: truncated && sliceKeys.length > 0 ? sliceKeys[sliceKeys.length - 1] : undefined,
      delimitedPrefixes,
    };
  }
}
