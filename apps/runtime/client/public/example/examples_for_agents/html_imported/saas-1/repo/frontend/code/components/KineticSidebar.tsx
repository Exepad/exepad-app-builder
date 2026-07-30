import { React, cn, navigate } from '@exepad/sdk';

const navItems = [
  { label: 'Overview', icon: 'dashboard', href: '/' },
  { label: 'Keywords', icon: 'key', href: '/keywords' },
  { label: 'Backlinks', icon: 'link', href: null },
  { label: 'Competitors', icon: 'analytics', href: null },
  { label: 'Landing', icon: 'web', href: '/landing' },
  { label: 'Pricing', icon: 'payments', href: '/pricing' },
  { label: 'Settings', icon: 'settings', href: null },
];

export default function KineticSidebar({ className }) {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const currentPath = path.replace(/^\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+/, '') || '/';

  return (
    <aside className={cn('h-full w-64 shrink-0 hidden lg:flex flex-col bg-[#131313]', className)} style={{ fontFamily: 'Inter' }}>
      <div className="flex flex-col h-full p-6 space-y-8">
        {/* Branding */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-[#cc97ff] to-[#9c48ea] flex items-center justify-center">
            <span className="material-symbols-outlined text-black text-sm">bolt</span>
          </div>
          <span className="font-bold text-[#cc97ff] tracking-tight" style={{ fontFamily: 'Manrope' }}>KINETIC</span>
        </div>

        {/* Project Info */}
        <div className="flex flex-col space-y-4">
          <div className="flex flex-col space-y-1">
            <span className="text-white font-bold text-sm tracking-tight" style={{ fontFamily: 'Manrope' }}>Project Alpha</span>
            <span className="text-[#adaaaa] text-xs">SEO Command Center</span>
          </div>
          <button className="w-full py-2.5 px-4 bg-gradient-to-r from-[#cc97ff] to-[#9c48ea] text-black font-semibold text-sm rounded-lg transition-transform active:scale-95">
            New Audit
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-[#adaaaa] font-bold mb-4 px-2">Main Menu</p>
          {navItems.map((item) => {
            const isActive = item.href !== null && currentPath === item.href;
            const isClickable = item.href !== null;
            return (
              <a
                key={item.label}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-in-out',
                  isActive
                    ? 'bg-[#1a1919] text-[#cc97ff] shadow-[0_0_15px_rgba(204,151,255,0.1)] font-medium'
                    : 'text-[#adaaaa] hover:text-white hover:bg-[#1a1919]',
                  isClickable ? 'cursor-pointer' : 'cursor-default opacity-60'
                )}
                onClick={(e) => {
                  e.preventDefault();
                  if (isClickable) navigate(item.href);
                }}
              >
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {item.icon}
                </span>
                <span className="text-sm font-medium">{item.label}</span>
              </a>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
          <a className="flex items-center gap-3 px-3 py-2 text-[#adaaaa] hover:text-[#3adffa] text-sm transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">help</span>
            <span className="text-xs">Support</span>
          </a>
          <a className="flex items-center gap-3 px-3 py-2 text-[#adaaaa] hover:text-[#3adffa] text-sm transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">description</span>
            <span className="text-xs">Documentation</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
