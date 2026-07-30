import { React, cn } from '@exepad/sdk';

export default function PricingContent({ className }) {
  return (
    <div className={cn('bg-[#0e0e0e] text-white', className)} style={{ fontFamily: 'Inter' }}>
      <main className="pt-32 pb-24 px-6 md:px-12 max-w-7xl mx-auto">
        {/* Hero Header */}
        <header className="text-center mb-20">
          <h1
            className="text-5xl md:text-7xl font-extrabold tracking-tighter mb-6"
            style={{ fontFamily: 'Manrope' }}
          >
            Scale Your <span className="text-[#cc97ff]">Intelligence</span>
          </h1>
          <p className="text-[#adaaaa] max-w-2xl mx-auto text-lg md:text-xl">
            Choose the performance tier that aligns with your operational velocity. Liquid data, architected for growth.
          </p>
        </header>

        {/* Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {/* Basic Tier */}
          <div className="glass-card glow-border p-10 flex flex-col rounded-xl border border-white/5">
            <div className="mb-8">
              <h3
                className="text-xl font-bold uppercase tracking-widest text-white mb-2"
                style={{ fontFamily: 'Manrope' }}
              >
                Basic
              </h3>
              <p className="text-[#adaaaa] text-sm">For individuals and startups</p>
            </div>
            <div className="mb-8">
              <div className="flex items-baseline">
                <span className="text-4xl font-black" style={{ fontFamily: 'Manrope' }}>$49</span>
                <span className="text-[#adaaaa] ml-2">/month</span>
              </div>
            </div>
            <ul className="space-y-4 mb-10 flex-grow">
              <li className="flex items-center text-sm">
                <span
                  className="material-symbols-outlined text-[#3adffa] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                5 Keyword Tracks
              </li>
              <li className="flex items-center text-sm text-[#adaaaa]">
                <span
                  className="material-symbols-outlined text-[#3adffa] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                Weekly SEO Audits
              </li>
              <li className="flex items-center text-sm text-[#adaaaa]">
                <span
                  className="material-symbols-outlined text-[#3adffa] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                Basic Competitor Insight
              </li>
            </ul>
            <button
              className="w-full py-4 rounded-md border border-[#484847] hover:bg-white/5 transition-all font-bold uppercase tracking-tight text-sm"
              style={{ fontFamily: 'Manrope' }}
            >
              Select Basic
            </button>
          </div>

          {/* Pro Tier (Featured) */}
          <div className="glass-card featured-glow relative p-10 flex flex-col rounded-xl border border-[#cc97ff]/30 transform md:-translate-y-4">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#cc97ff] px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-[#47007c] shadow-[0_0_20px_rgba(204,151,255,0.5)]">
              Most Popular
            </div>
            <div className="mb-8">
              <h3
                className="text-xl font-bold uppercase tracking-widest text-[#cc97ff] mb-2"
                style={{ fontFamily: 'Manrope' }}
              >
                Pro
              </h3>
              <p className="text-[#adaaaa] text-sm">The digital command center</p>
            </div>
            <div className="mb-8">
              <div className="flex items-baseline">
                <span className="text-6xl font-black text-white" style={{ fontFamily: 'Manrope' }}>$149</span>
                <span className="text-[#adaaaa] ml-2">/month</span>
              </div>
            </div>
            <ul className="space-y-4 mb-10 flex-grow">
              <li className="flex items-center text-sm font-medium">
                <span
                  className="material-symbols-outlined text-[#cc97ff] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  bolt
                </span>
                Unlimited Keyword Tracks
              </li>
              <li className="flex items-center text-sm">
                <span
                  className="material-symbols-outlined text-[#cc97ff] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                Daily SEO Audits
              </li>
              <li className="flex items-center text-sm">
                <span
                  className="material-symbols-outlined text-[#cc97ff] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                Advanced AI Prediction
              </li>
              <li className="flex items-center text-sm">
                <span
                  className="material-symbols-outlined text-[#cc97ff] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                Competitor Content Gaps
              </li>
            </ul>
            <button
              className="w-full py-4 rounded-md bg-gradient-to-r from-[#cc97ff] to-[#9c48ea] text-black hover:opacity-90 transition-all font-bold uppercase tracking-tight text-sm shadow-[0_0_30px_rgba(204,151,255,0.2)]"
              style={{ fontFamily: 'Manrope' }}
            >
              Upgrade to Pro
            </button>
          </div>

          {/* Enterprise Tier */}
          <div className="glass-card glow-border p-10 flex flex-col rounded-xl border border-white/5">
            <div className="mb-8">
              <h3
                className="text-xl font-bold uppercase tracking-widest text-white mb-2"
                style={{ fontFamily: 'Manrope' }}
              >
                Enterprise
              </h3>
              <p className="text-[#adaaaa] text-sm">For global-scale operations</p>
            </div>
            <div className="mb-8">
              <div className="flex items-baseline">
                <span className="text-4xl font-black" style={{ fontFamily: 'Manrope' }}>$499</span>
                <span className="text-[#adaaaa] ml-2">/month</span>
              </div>
            </div>
            <ul className="space-y-4 mb-10 flex-grow">
              <li className="flex items-center text-sm">
                <span
                  className="material-symbols-outlined text-[#ff86c3] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  verified_user
                </span>
                Custom Integration API
              </li>
              <li className="flex items-center text-sm text-[#adaaaa]">
                <span
                  className="material-symbols-outlined text-[#ff86c3] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                Dedicated SEO Architect
              </li>
              <li className="flex items-center text-sm text-[#adaaaa]">
                <span
                  className="material-symbols-outlined text-[#ff86c3] mr-3"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                24/7 Priority Support
              </li>
            </ul>
            <button
              className="w-full py-4 rounded-md border border-[#484847] hover:bg-white/5 transition-all font-bold uppercase tracking-tight text-sm"
              style={{ fontFamily: 'Manrope' }}
            >
              Contact Sales
            </button>
          </div>
        </div>

        {/* Trust Section */}
        <div className="mt-24 pt-12 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-8 opacity-40 grayscale hover:grayscale-0 transition-all duration-700">
          <div className="flex items-center justify-center space-x-2">
            <span className="material-symbols-outlined">rocket_launch</span>
            <span className="font-bold tracking-widest text-xs" style={{ fontFamily: 'Manrope' }}>QUANTUM</span>
          </div>
          <div className="flex items-center justify-center space-x-2">
            <span className="material-symbols-outlined">diamond</span>
            <span className="font-bold tracking-widest text-xs" style={{ fontFamily: 'Manrope' }}>PLATINUM</span>
          </div>
          <div className="flex items-center justify-center space-x-2">
            <span className="material-symbols-outlined">cyclone</span>
            <span className="font-bold tracking-widest text-xs" style={{ fontFamily: 'Manrope' }}>VORTEX</span>
          </div>
          <div className="flex items-center justify-center space-x-2">
            <span className="material-symbols-outlined">all_inclusive</span>
            <span className="font-bold tracking-widest text-xs" style={{ fontFamily: 'Manrope' }}>ETERNITY</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#0e0e0e] border-t border-white/5 py-12 px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
          <div>
            <div className="text-lg font-black text-white mb-4" style={{ fontFamily: 'Manrope' }}>KINETIC</div>
            <p className="text-xs text-[#adaaaa] leading-relaxed">
              Elevating search visibility through algorithmic precision and liquid data architecture.
            </p>
          </div>
          <div className="flex flex-col space-y-3">
            <h4
              className="text-white text-xs font-bold uppercase tracking-widest mb-2"
              style={{ fontFamily: 'Manrope' }}
            >
              Platform
            </h4>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Features</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Pricing</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Solutions</a>
          </div>
          <div className="flex flex-col space-y-3">
            <h4
              className="text-white text-xs font-bold uppercase tracking-widest mb-2"
              style={{ fontFamily: 'Manrope' }}
            >
              Resources
            </h4>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Documentation</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">API Status</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Security</a>
          </div>
          <div className="flex flex-col space-y-3">
            <h4
              className="text-white text-xs font-bold uppercase tracking-widest mb-2"
              style={{ fontFamily: 'Manrope' }}
            >
              Legal
            </h4>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Privacy Policy</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Terms of Service</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Contact</a>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-16 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <span className="text-xs text-[#adaaaa]">&copy; 2024 KINETIC SEO. Powered by Liquid Data.</span>
          <div className="flex space-x-6">
            <span className="material-symbols-outlined text-[#adaaaa] text-sm cursor-pointer hover:text-white">public</span>
            <span className="material-symbols-outlined text-[#adaaaa] text-sm cursor-pointer hover:text-white">mail</span>
            <span className="material-symbols-outlined text-[#adaaaa] text-sm cursor-pointer hover:text-white">share</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
