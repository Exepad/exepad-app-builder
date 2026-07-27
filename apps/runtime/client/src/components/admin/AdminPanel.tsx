import { useState } from 'react';
import type { AdminMode } from '../../services/AdminApi';
import DatabaseAdmin from './DatabaseAdmin';
import UsersAdmin from './UsersAdmin';
import FilesAdmin from './FilesAdmin';
import SecurityAdmin from './SecurityAdmin';

type Tab = 'database' | 'users' | 'files' | 'security';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'database', label: 'Database' },
  { id: 'users', label: 'Users' },
  { id: 'files', label: 'Files' },
  { id: 'security', label: 'Security' },
];

/**
 * Per-app admin console, rendered inside the Studio's right pane. Lets the
 * operator manage the generated app's data, end-users, files, and auth settings.
 * `mode` chooses which build it targets: the live `published` app or the
 * `preview` draft shown in the iframe.
 */
export default function AdminPanel({ appId }: { appId: string }) {
  const [tab, setTab] = useState<Tab>('database');
  const [mode, setMode] = useState<AdminMode>('preview');

  // Remount sub-panels on app/mode change so internal state (paging, selection)
  // resets cleanly.
  const key = `${appId}:${mode}`;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      {/* Sub-tabs + mode switcher */}
      <div className="flex items-center justify-between border-b border-border px-3">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ModeSwitch mode={mode} onChange={setMode} />
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        {tab === 'database' && <DatabaseAdmin key={key} appId={appId} mode={mode} />}
        {tab === 'users' && <UsersAdmin key={key} appId={appId} mode={mode} />}
        {tab === 'files' && <FilesAdmin key={key} appId={appId} mode={mode} />}
        {tab === 'security' && <SecurityAdmin key={key} appId={appId} mode={mode} />}
      </div>
    </div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: AdminMode; onChange: (m: AdminMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 text-xs">
      {(['preview', 'published'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded px-2 py-1 font-medium capitalize transition-colors ${
            mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
