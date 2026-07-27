import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
  revokeSessions,
  type AdminMode,
  type AppUser,
  type Pagination as PageInfo,
} from '../../services/AdminApi';
import { btn, inputClass, Spinner, EmptyState, ErrorBanner, Pagination, Modal, Confirm } from './ui';

const PAGE_SIZE = 20;

export default function UsersAdmin({ appId, mode }: { appId: string; mode: AdminMode }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [resetting, setResetting] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listUsers(appId, mode, { page, pageSize: PAGE_SIZE, search });
    setUsers(res.users);
    setPageInfo(res.pagination);
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
            placeholder="Search email or name…"
            className={`${inputClass} w-56`}
          />
        </form>
        <button className={`${btn.primary} ml-auto`} onClick={() => setCreating(true)}>
          + Add user
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        {loading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : users.length === 0 ? (
          <EmptyState>
            <p>{search ? 'No users match your search.' : 'No end-users yet.'}</p>
            {!search && (
              <p className="text-xs">
                End-users exist only when the app has authentication enabled (see the Security tab).
              </p>
            )}
          </EmptyState>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted/60 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Roles</th>
                <th className="px-3 py-2 font-medium">Verified</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-1.5">{u.email}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{u.name || '—'}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{u.roles || '—'}</td>
                  <td className="px-3 py-1.5">
                    {u.email_verified ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button className={btn.ghostSm} onClick={() => setEditing(u)}>
                      Edit
                    </button>
                    <button className={btn.ghostSm} onClick={() => setResetting(u)}>
                      Reset PW
                    </button>
                    <button className={btn.ghostSm} onClick={() => setDeleting(u)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} total={pageInfo.total} onPage={setPage} />

      {creating && (
        <CreateUser appId={appId} mode={mode} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />
      )}
      {editing && (
        <EditUser appId={appId} mode={mode} user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      )}
      {resetting && (
        <ResetPassword appId={appId} mode={mode} user={resetting} onClose={() => setResetting(null)} />
      )}
      {deleting && (
        <DeleteUser appId={appId} mode={mode} user={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); void load(); }} />
      )}
    </div>
  );
}

function CreateUser({
  appId,
  mode,
  onClose,
  onSaved,
}: {
  appId: string;
  mode: AdminMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState('user');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await createUser(appId, mode, { email: email.trim(), password, name: name.trim() || undefined, roles: roles.trim() || undefined });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error ?? 'Could not create user.');
  }

  return (
    <Modal
      title="Add user"
      onClose={onClose}
      footer={
        <>
          <button className={btn.outline} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btn.primary} onClick={save} disabled={busy || !email.trim() || password.length < 8}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      {err && <div className="mb-3"><ErrorBanner message={err} /></div>}
      <div className="space-y-3">
        <Field label="Email">
          <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </Field>
        <Field label="Password (min 8 chars)">
          <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} type="text" />
        </Field>
        <Field label="Name (optional)">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Roles (comma-separated)">
          <input className={inputClass} value={roles} onChange={(e) => setRoles(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function EditUser({
  appId,
  mode,
  user,
  onClose,
  onSaved,
}: {
  appId: string;
  mode: AdminMode;
  user: AppUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [name, setName] = useState(user.name ?? '');
  const [roles, setRoles] = useState(user.roles ?? '');
  const [verified, setVerified] = useState(Boolean(user.email_verified));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await updateUser(appId, mode, user.id, {
      email: email.trim(),
      name: name.trim(),
      roles: roles.trim(),
      email_verified: verified,
    });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error ?? 'Could not update user.');
  }

  async function revoke() {
    setBusy(true);
    await revokeSessions(appId, mode, user.id);
    setBusy(false);
  }

  return (
    <Modal
      title="Edit user"
      onClose={onClose}
      footer={
        <>
          <button className={btn.outline} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={btn.primary} onClick={save} disabled={busy || !email.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {err && <div className="mb-3"><ErrorBanner message={err} /></div>}
      <div className="space-y-3">
        <Field label="Email">
          <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </Field>
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Roles (comma-separated)">
          <input className={inputClass} value={roles} onChange={(e) => setRoles(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
          Email verified
        </label>
        <button className={btn.outline} onClick={revoke} disabled={busy}>
          Revoke all active sessions
        </button>
      </div>
    </Modal>
  );
}

function ResetPassword({
  appId,
  mode,
  user,
  onClose,
}: {
  appId: string;
  mode: AdminMode;
  user: AppUser;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await resetPassword(appId, mode, user.id, password);
    setBusy(false);
    if (res.ok) setDone(true);
    else setErr(res.error ?? 'Could not reset password.');
  }

  return (
    <Modal
      title={`Reset password · ${user.email}`}
      onClose={onClose}
      footer={
        done ? (
          <button className={btn.primary} onClick={onClose}>Done</button>
        ) : (
          <>
            <button className={btn.outline} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={btn.primary} onClick={save} disabled={busy || password.length < 8}>
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
          </>
        )
      }
    >
      {done ? (
        <p className="text-sm text-muted-foreground">
          Password updated and all of this user's sessions were revoked.
        </p>
      ) : (
        <>
          {err && <div className="mb-3"><ErrorBanner message={err} /></div>}
          <Field label="New password (min 8 chars)">
            <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} type="text" />
          </Field>
          <p className="mt-2 text-xs text-muted-foreground">All active sessions will be revoked.</p>
        </>
      )}
    </Modal>
  );
}

function DeleteUser({
  appId,
  mode,
  user,
  onClose,
  onDeleted,
}: {
  appId: string;
  mode: AdminMode;
  user: AppUser;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Confirm
      title="Delete user"
      message={`Delete ${user.email}? Their sessions and linked accounts are removed too. This cannot be undone.`}
      busy={busy}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        const res = await deleteUser(appId, mode, user.id);
        setBusy(false);
        if (res.ok) onDeleted();
        else onClose();
      }}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}
