import { React, cn, navigate, useModel, useCurrentUser, useHandler, toast } from '@exepad/sdk';

const navItems = [
  { label: 'Overview', icon: 'dashboard', href: '/' },
  { label: 'Hives', icon: 'grid_view', href: '/hives' },
  { label: 'Honey Production', icon: 'water_drop', href: '/honey-production' },
  { label: 'Pest Control', icon: 'bug_report', href: '/pest-control' },
  { label: 'Settings', icon: 'settings', href: '/settings' },
];

export default function DashboardSidebar({ className }) {
  const user = useCurrentUser();
  const { data: hives } = useModel('hives', { limit: 1, orderBy: { name: 'asc' } });
  const signout = useHandler('auth_signout', { autoFetch: false });
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const currentPath = path.replace(/^\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+/, '') || '/';

  return (
    <aside className={cn('h-full w-64 shrink-0 hidden lg:flex flex-col bg-slate-50 border-r border-slate-100', className)} style={{ fontFamily: 'Inter' }}>
      <div className="flex flex-col h-full py-8 px-4 gap-2">
        {/* Header Identity */}
        <div className="px-4 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#835400] flex items-center justify-center shadow-lg shadow-[#835400]/20">
              <span className="material-symbols-outlined text-white">hive</span>
            </div>
            <h1 className="font-black text-amber-700 text-xl tracking-tight leading-none" style={{ fontFamily: 'Manrope' }}>
              The Living Ledger
            </h1>
          </div>
          <div className="p-3 bg-[#a0f399]/30 rounded-lg">
            <p className="text-[10px] font-bold text-[#217128]/60 uppercase tracking-widest mb-1">CURRENT STATUS</p>
            <p className="font-bold text-sm text-[#217128]" style={{ fontFamily: 'Manrope' }}>{hives?.[0] ? `${hives[0].name} Status: ${hives[0].status}` : 'No hives yet'}</p>
          </div>
        </div>

        {/* Main Nav Items */}
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const isActive = currentPath === item.href;
            return (
              <a
                key={item.label}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer',
                  isActive
                    ? 'text-amber-800 font-bold border-r-4 border-amber-600 bg-amber-50/50'
                    : 'text-slate-600 hover:text-amber-600 hover:bg-slate-100'
                )}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.href);
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {item.icon}
                </span>
                <span className="text-sm font-medium tracking-wide">{item.label}</span>
              </a>
            );
          })}
        </nav>

        {/* CTA */}
        <button className="mt-4 mx-2 bg-[#835400] text-white py-3 px-4 rounded-xl font-bold text-sm shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2" style={{ fontFamily: 'Manrope' }}>
          <span className="material-symbols-outlined text-lg">add</span>
          Add Inspection
        </button>

        {/* Footer Nav */}
        <div className="mt-auto pt-4 border-t border-slate-100 space-y-1">
          <a className="flex items-center gap-3 px-4 py-2 rounded-xl text-slate-500 hover:text-slate-900 transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">help</span>
            <span className="text-xs font-medium">Help Center</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-2 rounded-xl text-slate-500 hover:text-[#ba1a1a] transition-colors cursor-pointer" onClick={async (e) => { e.preventDefault(); await signout.execute({}); navigate('/'); }}>
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="text-xs font-medium">Logout</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
