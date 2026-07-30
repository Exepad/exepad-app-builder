import { React, cn, navigate } from '@exepad/sdk';

const navLinks = [
  { label: 'Features', href: '/landing' },
  { label: 'Solutions', href: null },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Resources', href: null },
];

export default function KineticHeader({ className }) {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const currentPath = path.replace(/^\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+/, '') || '/';

  return (
    <nav className={cn('w-full z-50 bg-[#0e0e0e]/80 backdrop-blur-xl flex justify-between items-center px-8 h-20 max-w-full bg-gradient-to-b from-white/5 to-transparent shadow-[0_0_40px_rgba(204,151,255,0.08)]', className)}>
      <div
        className="text-2xl font-black tracking-tighter text-white cursor-pointer"
        style={{ fontFamily: 'Manrope' }}
        onClick={() => navigate('/')}
      >
        KINETIC
      </div>
      <div className="hidden md:flex items-center space-x-8">
        {navLinks.map((link) => {
          const isActive = link.href !== null && currentPath === link.href;
          return (
            <a
              key={link.label}
              className={cn(
                'tracking-tight font-bold uppercase transition-colors cursor-pointer',
                isActive
                  ? 'text-[#cc97ff] border-b border-[#cc97ff]/50'
                  : 'text-[#adaaaa] hover:text-white'
              )}
              style={{ fontFamily: 'Manrope' }}
              onClick={(e) => {
                e.preventDefault();
                if (link.href) navigate(link.href);
              }}
            >
              {link.label}
            </a>
          );
        })}
      </div>
      <div className="flex items-center space-x-6">
        <button
          className="text-[#adaaaa] hover:text-white transition-colors tracking-tight font-bold uppercase"
          style={{ fontFamily: 'Manrope' }}
        >
          Login
        </button>
        <button
          className="bg-gradient-to-r from-[#cc97ff] to-[#9c48ea] text-black px-6 py-2.5 rounded-md tracking-tight font-bold uppercase transition-all duration-300 scale-95 active:scale-90 shadow-[0_0_20px_rgba(204,151,255,0.3)]"
          style={{ fontFamily: 'Manrope' }}
        >
          Get Started
        </button>
      </div>
    </nav>
  );
}
