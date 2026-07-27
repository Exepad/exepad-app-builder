import { useCallback, useEffect, useState } from 'react';
import {
  listFiles,
  deleteFile,
  fileDownloadUrl,
  type AdminMode,
  type AppFile,
} from '../../services/AdminApi';
import { btn, inputClass, Spinner, EmptyState, ErrorBanner, Pagination, Confirm } from './ui';

const PAGE_SIZE = 20;

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function FilesAdmin({ appId, mode }: { appId: string; mode: AdminMode }) {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AppFile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listFiles(appId, mode, { page, pageSize: PAGE_SIZE, search });
    setFiles(res.items);
    setTotal(res.total);
    setLoading(false);
  }, [appId, mode, page, search]);

  useEffect(() => {
    setPage(1);
    setSearch('');
    setSearchInput('');
  }, [appId, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search filename…"
            className={`${inputClass} w-56`}
          />
        </form>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        {loading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : files.length === 0 ? (
          <EmptyState>
            <p>{search ? 'No files match your search.' : 'No files uploaded yet.'}</p>
            {!search && <p className="text-xs">Files appear here when the app has file storage enabled.</p>}
          </EmptyState>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted/60 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Filename</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Visibility</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t border-border hover:bg-muted/30">
                  <td className="max-w-[10rem] truncate px-3 py-1.5 sm:max-w-[18rem]" title={f.filename}>
                    {f.filename}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{f.contentType || '—'}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{formatBytes(f.sizeBytes)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{f.visibility || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <a
                      className={btn.ghostSm}
                      href={fileDownloadUrl(appId, f.id, mode)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download
                    </a>
                    <button className={btn.ghostSm} onClick={() => setDeleting(f)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPage={setPage} />

      {deleting && (
        <Confirm
          title="Delete file"
          message={`Delete "${deleting.filename}"? This removes it from the app.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const res = await deleteFile(appId, mode, deleting.id);
            setDeleting(null);
            if (res.ok) void load();
          }}
        />
      )}
    </div>
  );
}
