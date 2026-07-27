import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listTables,
  getTableSchema,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  type AdminMode,
  type DbTable,
  type DbColumn,
  type DbIndex,
  type DbRow,
  type Pagination as PageInfo,
} from '../../services/AdminApi';
import {
  btn,
  inputClass,
  Spinner,
  EmptyState,
  ErrorBanner,
  Pagination,
  Modal,
  Confirm,
  cellText,
} from './ui';

const PAGE_SIZE = 25;

/** Columns the DB fills automatically — pre-filled / hidden in the insert form. */
const AUTO_TS = new Set(['created_at', 'updated_at']);

export default function DatabaseAdmin({ appId, mode }: { appId: string; mode: AdminMode }) {
  const [tables, setTables] = useState<DbTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const [rows, setRows] = useState<DbRow[]>([]);
  const [columns, setColumns] = useState<DbColumn[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [schema, setSchema] = useState<{ columns: DbColumn[]; indexes: DbIndex[] } | null>(null);
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; row: DbRow } | null>(null);
  const [deleting, setDeleting] = useState<DbRow | null>(null);

  const pkColumn = useMemo(() => columns.find((c) => c.pk)?.name ?? null, [columns]);

  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    const t = await listTables(appId, mode);
    setTables(t);
    setSelected((prev) => (prev && t.some((x) => x.name === prev) ? prev : t[0]?.name ?? null));
    setTablesLoading(false);
  }, [appId, mode]);

  const reqIdRef = useRef(0);
  const loadRows = useCallback(async () => {
    if (!selected) return;
    // Sequence guard: a fast table/mode/page switch can fire overlapping loads;
    // ignore any response that isn't from the most recent request.
    const reqId = ++reqIdRef.current;
    setRowsLoading(true);
    setError(null);
    const res = await listRows(appId, selected, mode, { page, pageSize: PAGE_SIZE, search });
    if (reqId !== reqIdRef.current) return;
    if (!res.ok && res.error) setError(res.error);
    setRows(res.rows);
    setColumns(res.columns);
    setPageInfo(res.pagination);
    setRowsLoading(false);
  }, [appId, selected, mode, page, search]);

  // Reset selection + reload table list when app/mode changes.
  useEffect(() => {
    setSelected(null);
    setSearch('');
    setSearchInput('');
    setPage(1);
    void loadTables();
  }, [loadTables]);

  // Reset paging when switching tables.
  useEffect(() => {
    setPage(1);
    setSearch('');
    setSearchInput('');
  }, [selected]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  async function openSchema() {
    if (!selected) return;
    const s = await getTableSchema(appId, selected, mode);
    if (s) setSchema(s);
  }

  if (tablesLoading) {
    return (
      <div className="p-4">
        <Spinner label="Loading tables…" />
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <EmptyState>
        <p>This app has no data tables.</p>
        <p className="text-xs">Tables appear here once the app defines backend models.</p>
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-4">
      {/* Table selector + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected ?? ''}
          onChange={(e) => setSelected(e.target.value)}
          className={`${inputClass} w-auto min-w-[10rem]`}
        >
          {tables.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.rowCount})
            </option>
          ))}
        </select>
        <button className={btn.outline} onClick={openSchema} disabled={!selected}>
          Schema
        </button>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <form
            className="min-w-0 flex-1 sm:flex-none"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}
          >
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search…"
              className={`${inputClass} w-full sm:w-40`}
            />
          </form>
          <button
            className={btn.primary}
            onClick={() => {
              const blank: DbRow = {};
              for (const col of columns) {
                if (col.pk) continue;
                blank[col.name] = AUTO_TS.has(col.name) ? new Date().toISOString() : '';
              }
              setEditor({ mode: 'create', row: blank });
            }}
          >
            + Add row
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Rows table */}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        {rowsLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState>
            <p>{search ? 'No rows match your search.' : 'No rows yet.'}</p>
          </EmptyState>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted/60 text-left">
              <tr>
                {columns.map((col) => (
                  <th key={col.name} className="whitespace-nowrap px-3 py-2 font-medium">
                    {col.name}
                    {col.pk && <span className="ml-1 text-[10px] text-muted-foreground">PK</span>}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border hover:bg-muted/30">
                  {columns.map((col) => (
                    <td key={col.name} className="max-w-[20rem] truncate px-3 py-1.5" title={cellText(row[col.name])}>
                      {cellText(row[col.name])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button
                      className={btn.ghostSm}
                      disabled={!pkColumn}
                      onClick={() => setEditor({ mode: 'edit', row })}
                    >
                      Edit
                    </button>
                    <button className={btn.ghostSm} disabled={!pkColumn} onClick={() => setDeleting(row)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        page={pageInfo.page}
        totalPages={pageInfo.totalPages}
        total={pageInfo.total}
        onPage={setPage}
      />

      {schema && (
        <SchemaModal table={selected ?? ''} schema={schema} onClose={() => setSchema(null)} />
      )}

      {editor && (
        <RowEditor
          appId={appId}
          mode={mode}
          table={selected!}
          columns={columns}
          pkColumn={pkColumn}
          editorMode={editor.mode}
          initial={editor.row}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void loadRows();
            void loadTables();
          }}
        />
      )}

      {deleting && pkColumn && (
        <DeleteRow
          appId={appId}
          mode={mode}
          table={selected!}
          rowId={deleting[pkColumn] as string | number}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void loadRows();
            void loadTables();
          }}
          onError={(msg) => {
            setDeleting(null);
            setError(msg);
          }}
        />
      )}
    </div>
  );
}

function SchemaModal({
  table,
  schema,
  onClose,
}: {
  table: string;
  schema: { columns: DbColumn[]; indexes: DbIndex[] };
  onClose: () => void;
}) {
  return (
    <Modal title={`Schema · ${table}`} onClose={onClose} wide>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns</h4>
      <table className="mb-4 w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 pr-3">Name</th>
            <th className="py-1 pr-3">Type</th>
            <th className="py-1 pr-3">Null</th>
            <th className="py-1 pr-3">Default</th>
            <th className="py-1">Key</th>
          </tr>
        </thead>
        <tbody>
          {schema.columns.map((col) => (
            <tr key={col.name} className="border-t border-border">
              <td className="py-1 pr-3 font-medium">{col.name}</td>
              <td className="py-1 pr-3 text-muted-foreground">{col.type || '—'}</td>
              <td className="py-1 pr-3 text-muted-foreground">{col.notnull ? 'NOT NULL' : 'nullable'}</td>
              <td className="py-1 pr-3 text-muted-foreground">{col.dflt_value ?? '—'}</td>
              <td className="py-1 text-muted-foreground">{col.pk ? 'PK' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Indexes</h4>
      {schema.indexes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No indexes.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {schema.indexes.map((idx) => (
            <li key={idx.name}>
              <span className="font-medium">{idx.name}</span>{' '}
              <span className="text-muted-foreground">
                ({idx.columns.join(', ')}){idx.unique ? ' · unique' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function RowEditor({
  appId,
  mode,
  table,
  columns,
  pkColumn,
  editorMode,
  initial,
  onClose,
  onSaved,
}: {
  appId: string;
  mode: AdminMode;
  table: string;
  columns: DbColumn[];
  pkColumn: string | null;
  editorMode: 'create' | 'edit';
  initial: DbRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const col of columns) v[col.name] = initial[col.name] == null ? '' : String(initial[col.name]);
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // On create, the PK (autoincrement) is omitted entirely.
  const editable = columns.filter((c) => !(editorMode === 'create' && c.pk));

  // Numeric-affinity columns get a real number so the DB stores the right type.
  function coerce(col: DbColumn, raw: string): string | number {
    const t = col.type.toUpperCase();
    const numeric = /INT|REAL|FLOA|DOUB|NUM|DEC/.test(t);
    if (numeric && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
    return raw;
  }

  async function save() {
    setBusy(true);
    setErr(null);

    // Build payload. PK is never sent (create: autoincrement; edit: used in WHERE).
    // On CREATE a blank field is OMITTED so the column's DEFAULT / NOT NULL rules
    // apply — sending explicit NULL would defeat defaults and break required cols.
    // On EDIT a blank field is sent as NULL so the operator can clear a value.
    const payload: Record<string, unknown> = {};
    for (const col of editable) {
      if (col.name === pkColumn) continue;
      const raw = values[col.name] ?? '';
      if (raw === '') {
        if (editorMode === 'create') continue;
        payload[col.name] = null;
        continue;
      }
      payload[col.name] = coerce(col, raw);
    }

    const res =
      editorMode === 'create'
        ? await insertRow(appId, table, mode, payload)
        : await updateRow(appId, table, mode, initial[pkColumn!] as string | number, payload);

    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error ?? 'Save failed.');
  }

  return (
    <Modal
      title={editorMode === 'create' ? `Add row · ${table}` : `Edit row · ${table}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className={btn.outline} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={btn.primary} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {err && (
        <div className="mb-3">
          <ErrorBanner message={err} />
        </div>
      )}
      <div className="space-y-3">
        {editable.map((col) => {
          const isPkReadonly = editorMode === 'edit' && col.name === pkColumn;
          const isText = col.type.toUpperCase().includes('TEXT');
          return (
            <label key={col.name} className="block">
              <span className="mb-1 block text-xs font-medium">
                {col.name}
                <span className="ml-1 font-normal text-muted-foreground">
                  {col.type || 'ANY'}
                  {col.notnull ? ' · required' : ''}
                </span>
              </span>
              {isText ? (
                <textarea
                  value={values[col.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))}
                  disabled={isPkReadonly}
                  rows={2}
                  className={`${inputClass} resize-y`}
                />
              ) : (
                <input
                  value={values[col.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [col.name]: e.target.value }))}
                  disabled={isPkReadonly}
                  placeholder={col.notnull ? 'required' : 'null'}
                  className={inputClass}
                />
              )}
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

function DeleteRow({
  appId,
  mode,
  table,
  rowId,
  onClose,
  onDeleted,
  onError,
}: {
  appId: string;
  mode: AdminMode;
  table: string;
  rowId: string | number;
  onClose: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Confirm
      title="Delete row"
      message={`Permanently delete this row from "${table}"? This cannot be undone.`}
      busy={busy}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        const res = await deleteRow(appId, table, mode, rowId);
        setBusy(false);
        if (res.ok) onDeleted();
        else onError(res.error ?? 'Delete failed.');
      }}
    />
  );
}
