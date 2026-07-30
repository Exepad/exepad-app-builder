---
name: file-upload-image
description: "File upload UI — drag-drop zone, click-to-pick, progress bar, thumbnail preview, validation (size/type), wired to the platform's R2 upload pipeline + <ExepadImage> for display. Load when a component plan calls for image upload, avatar upload, attachment upload, or document upload. Backend semantics live in surfaces/backend_surface/docs/09_FILE_STORAGE_GUIDE.md. Keywords: upload, file-upload, image-upload, avatar, attachment, drag-drop, dropzone, file-picker, r2, asset."
metadata:
  kind: domain
---
# Skill: File / Image Upload UI

Drag-drop dropzone with click-to-pick, validation, progress, and
thumbnail preview. Wires into the platform's R2 upload pipeline via
`useFileUpload` + `<ExepadImage>` for rendering.

## When to use

- Avatar upload (`user-profile-settings` skill composes this).
- Attachment field on a CRUD form (resume, brand logo, document).
- Bulk import zone (CSV, JSON).

For purely rendering already-uploaded images, use `<ExepadImage src={...} />`
directly — that's the existing image pipeline, not this skill.

## Single-file image upload

```tsx
import { useFileUpload, ExepadImage } from "@exepad/sdk";

// Record-linking is done via the options object — NOT a second upload() arg.
const { upload, isUploading, progress } = useFileUpload({
  modelName: 'users',
  recordId: record.id,
  fieldName: 'avatar_url',
  visibility: 'public',
});
const [imageUrl, setImageUrl] = useState<string | null>(initialUrl);
const [error, setError] = useState<string | null>(null);
const inputRef = useRef<HTMLInputElement>(null);

async function onFile(file: File) {
  setError(null);
  if (file.size > 5 * 1024 * 1024) {
    setError('Max 5 MB.');
    return;
  }
  if (!file.type.startsWith('image/')) {
    setError('Image files only.');
    return;
  }
  const result = await upload(file); // single File arg
  setImageUrl(result.url);
  // persist the URL string via your model:
  await update(record.id, { avatar_url: result.url });
}

return (
  <div>
    <Label>Avatar</Label>
    <div
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      onClick={() => inputRef.current?.click()}
      className="mt-2 group relative cursor-pointer rounded-lg border-2 border-dashed border-border hover:border-primary transition-colors p-6 text-center"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {imageUrl ? (
        <div className="flex items-center gap-4">
          <ExepadImage src={imageUrl} className="h-16 w-16 rounded-full object-cover" />
          <div className="text-sm text-muted-foreground">
            Click or drop to replace
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Icons.Upload className="mx-auto h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
          <p className="text-sm font-medium">Drop an image or click to browse</p>
          <p className="text-xs text-muted-foreground">PNG, JPG, WebP up to 5 MB</p>
        </div>
      )}
      {isUploading && (
        <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
    {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
  </div>
);
```

## Drag-drop UX rules

- **`onDragOver` MUST `preventDefault()`** or the browser opens the file in the page.
- **Visual feedback during drag:**

```tsx
const [dragActive, setDragActive] = useState(false);

<div
  onDragEnter={() => setDragActive(true)}
  onDragLeave={() => setDragActive(false)}
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => { e.preventDefault(); setDragActive(false); /* handle */ }}
  className={`border-2 border-dashed transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'border-border'}`}
>
```

- **Click-to-pick is NOT optional.** Drag-drop is bonus UX. The hidden
  `<input type="file" className="sr-only">` + click-on-zone is the
  primary path.
- **Validate type and size before upload.** Don't waste an upload to
  reject after the round-trip.

## Multi-file / gallery upload

```tsx
const { upload } = useFileUpload({ modelName: 'gallery_images', fieldName: 'image_url', visibility: 'public' });
const [items, setItems] = useState<{ id: string; url: string; name: string }[]>([]);

async function onFiles(files: FileList) {
  for (const file of Array.from(files)) {
    const result = await upload(file); // single File arg — options carry the linking
    setItems((prev) => [...prev, { id: result.id, url: result.url, name: file.name }]);
  }
}

<input type="file" accept="image/*" multiple onChange={(e) => e.target.files && onFiles(e.target.files)} />

<div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
  {items.map((item) => (
    <div key={item.id} className="relative group">
      <ExepadImage src={item.url} className="aspect-square w-full rounded-lg object-cover" />
      <button
        onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
        className="absolute top-1 right-1 p-1 rounded-full bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={`Remove ${item.name}`}
      >
        <Icons.X className="h-4 w-4" />
      </button>
    </div>
  ))}
</div>
```

## Validation conventions

| Field | Default cap | Why |
|-------|------------|-----|
| Avatar (square crop) | 5 MB, image/* | Most avatars are 100–400 KB after compress |
| Banner / hero image | 10 MB, image/* | Wider images, but still browser-friendly |
| Document attachment | 25 MB, application/pdf, application/* | Generic upload; tune per use case |
| CSV import | 10 MB, text/csv | Larger seeds; handler validates row-by-row |

Always show the cap in the helper text (`PNG, JPG, WebP up to 5 MB`).

## Persisting the URL

After upload, `result.url` is a stable `/a/...` path served by the
runtime worker. Persist it in the model (`avatar_url`, `attachment_url`)
via `useModel.update`. Don't store the original `File` blob.

For ephemeral previews before submit, `URL.createObjectURL(file)` is the
practical approach — `downloadFile()` / `downloadCsv()` are for file
*exports*, not previews, so they don't apply here. The validator emits a
**warning** (not an error) on any `createObjectURL`, so the preview still
saves — but that warning ships with the component whether or not you
revoke; revoking does not clear it. Revoke on unmount regardless, to avoid
leaking the blob URL:

```tsx
useEffect(() => {
  if (preview) return () => URL.revokeObjectURL(preview);
}, [preview]);
```

An un-revoked `createObjectURL` leaks memory — the `revokeObjectURL`
cleanup above is what makes the pattern correct. (It does not remove the
`createObjectURL` warning; that warning is benign and stays regardless.)

## Anti-patterns

- ✗ Calling `fetch('/upload', { method: 'POST', body: file })` directly. Use `useFileUpload` — it handles auth, R2 routing, and the asset URL convention.
- ✗ Storing base64 data URLs in the model. Bloats reads, hits payload limits.
- ✗ A drag-drop zone with no fallback for keyboard users. Always include the hidden file input + click-to-open.
- ✗ Auto-uploading without confirmation when the file is huge. If the file is > 10 MB, ask "Upload large file?" first.
- ✗ Showing only a "loading…" indicator during upload. Use a percentage progress bar — the user wants to know if it'll take 1 s or 30 s.

## Compatibility

`useFileUpload` + `<ExepadImage>` are SDK-exported. R2 storage, signed URLs, and asset rewriting happen automatically — see
[`surfaces/backend_surface/docs/09_FILE_STORAGE_GUIDE.md`](../../../../surfaces/backend_surface/docs/09_FILE_STORAGE_GUIDE.md)
for the backend wiring. Don't try to reach R2 directly from the
component.
