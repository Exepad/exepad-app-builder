# File Storage Guide — Component Usage

When the app has file storage enabled (`storage.enabled: true` in backend_surface),
components can upload, list, download, and delete files using the SDK hooks and
platform RPC endpoints.

## SDK Imports

```tsx
import {
  useFileUpload, buildFileUrl, extractAppIdFromUrl,
  Icons, Button, toast, React, LightDOMContainer,
} from "@exepad/sdk";
```

## Upload Files

Use the `useFileUpload()` hook. It provides upload progress tracking and cancellation.

```tsx
const { upload, progress, isUploading, error, cancel } = useFileUpload({
  visibility: "shared",  // "private" | "shared" | "public"
});

const handleUpload = async (file: File) => {
  try {
    const result = await upload(file);
    // result: { id, url, filename, contentType, size, visibility, createdAt }
    toast.success(`Uploaded: ${result.filename}`);
  } catch (err: any) {
    toast.error(err?.message ?? "Upload failed");
  }
};
```

**Progress bar:**
```tsx
{isUploading && (
  <div className="w-full bg-surface-container rounded-full h-2">
    <div className="bg-primary h-2 rounded-full" style={{ width: `${progress}%` }} />
  </div>
)}
```

## List Files

No SDK hook exists for listing. Use `fetch()` directly with the `_files/list` RPC:

```tsx
const appId = extractAppIdFromUrl() ?? "app";

const fetchFiles = async (limit = 20, offset = 0) => {
  const res = await fetch(`/api/${appId}/_files/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ limit, offset }),
  });
  const result = await res.json();
  // result.data: FileRecord[]
  // result.pagination: { total, limit, offset, hasMore }
  return result;
};
```

## Delete Files

```tsx
const deleteFile = async (fileId: string) => {
  const res = await fetch(`/api/${appId}/_files/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ id: fileId }),
  });
  const result = await res.json();
  if (result.success) toast.success("File deleted");
  else toast.error(result.error?.message ?? "Delete failed");
};
```

## File URLs & Downloads

**Build a file serving URL:**
```tsx
const url = buildFileUrl(appId, file.id, file.filename);
// → /api/{appId}/_files/{fileId}/{encodedFilename}
```

**CRITICAL:** Always use `buildFileUrl()` with the browser-extracted `appId`.
NEVER use `file.url` directly — it contains the server-side appId which may
differ from the browser URL (e.g., missing `preview-` prefix).

**Download a file programmatically:**
```tsx
const handleDownload = async (file: FileRecord) => {
  const url = buildFileUrl(appId, file.id, file.filename);
  const res = await fetch(url, { credentials: "include" });
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = file.filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
};
```

**NEVER use `<a href={url} target="_blank">` for downloads** — preview mode
auth cookies won't propagate to new tabs. Always use `fetch()` + blob download.

**Image thumbnails:**
```tsx
{file.contentType?.startsWith("image/") && (
  <img src={buildFileUrl(appId, file.id, file.filename)}
       className="w-10 h-10 rounded object-cover" />
)}
```

## Response Shape (camelCase)

The `_files/list` and upload responses return **camelCase** fields:

```typescript
interface FileRecord {
  id: string;           // UUID
  url: string;          // Server-side URL (do NOT use directly — see above)
  filename: string;     // Sanitized original filename
  contentType: string;  // MIME type (can be undefined — always use ?.)
  size: number;         // Size in bytes
  visibility: string;   // "private" | "shared" | "public"
  createdAt: string;    // ISO 8601 timestamp
}
```

**Null safety:** `contentType` may be undefined on some records.
Always guard: `file.contentType?.startsWith("image/")`, not `file.contentType.startsWith(...)`.

## Common Patterns

**Format file size:**
```tsx
const formatSize = (bytes: number) => {
  if (!bytes || isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
```

**File type icon:**
```tsx
const getFileIcon = (type?: string) => {
  if (!type) return Icons.File;
  if (type.startsWith("image/")) return Icons.Image;
  if (type === "application/pdf") return Icons.FileText;
  if (type.startsWith("text/")) return Icons.FileCode;
  return Icons.File;
};
```

## Anti-Patterns

- NEVER use `file.url` for `<img src>` or download links — use `buildFileUrl(appId, ...)`
- NEVER use `<a target="_blank">` for downloads in preview apps
- NEVER assume `contentType` is defined — always use `?.`
- NEVER use snake_case field names (`content_type`, `size_bytes`) — the API returns camelCase
- NEVER call `_files/*` endpoints without `credentials: "include"`
