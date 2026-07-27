import { React, cn } from '@exepad/sdk';

export default function LandingContent({ className }) {
  return (
    <div className={cn('bg-[#0e0e0e] text-white', className)} style={{ fontFamily: 'Inter' }}>
      <main className="relative">
        {/* Hero Background Ambient Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none">
          <div className="absolute top-[-10%] left-1/4 w-[500px] h-[500px] bg-[#9c48ea]/10 blur-[120px] rounded-full" />
          <div className="absolute top-[20%] right-1/4 w-[400px] h-[400px] bg-[#3adffa]/5 blur-[100px] rounded-full" />
        </div>

        {/* Hero Section */}
        <section className="relative pt-40 pb-20 px-8 max-w-7xl mx-auto flex flex-col items-center text-center">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-[#cc97ff]/10 border border-[#cc97ff]/20 mb-8">
            <span className="text-[10px] font-bold tracking-widest uppercase text-[#cc97ff] mr-2">New Release</span>
            <span className="text-[10px] font-medium text-[#adaaaa]">V4.0 Agentic Engine is Live</span>
          </div>
          <h1 className="text-6xl md:text-8xl font-extrabold tracking-tighter text-white mb-6 leading-none" style={{ fontFamily: 'Manrope' }}>
            SEO, <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#cc97ff] via-[#ff86c3] to-[#3adffa]">Reimagined.</span>
          </h1>
          <p className="text-[#adaaaa] text-lg md:text-xl max-w-2xl mb-12 leading-relaxed">
            The world's first autonomous SEO agent that doesn't just suggest keywords—it builds authority, optimizes code, and secures rankings while you sleep.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mb-20">
            <button className="px-8 py-4 bg-gradient-to-br from-[#cc97ff] to-[#9c48ea] text-[#47007c] font-bold rounded-xl shadow-[0_0_30px_rgba(204,151,255,0.3)] hover:scale-105 active:scale-95 transition-all">Start Free Trial</button>
            <button className="px-8 py-4 bg-[#1a1919] border border-[#484847]/30 text-white font-bold rounded-xl hover:bg-[#201f1f] transition-all">Watch Live Demo</button>
          </div>

          {/* Hero Glass Interface */}
          <div className="w-full max-w-5xl glass-card glow-border rounded-2xl overflow-hidden shadow-2xl relative group">
            <div className="h-10 bg-[#131313] flex items-center px-4 space-x-2 border-b border-white/5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#d73357]/40" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff86c3]/40" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#3adffa]/40" />
              <div className="flex-grow" />
              <div className="text-[10px] text-[#adaaaa]/50 font-mono tracking-widest uppercase">Agent Console / Running Analysis...</div>
            </div>
            <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Dashboard Sidebar Simulation */}
              <div className="md:col-span-1 space-y-6 text-left border-r border-white/5 pr-8">
                <div>
                  <div className="text-[10px] text-[#cc97ff] font-bold tracking-widest uppercase mb-4">Target Keyword</div>
                  <div className="text-2xl font-bold text-white" style={{ fontFamily: 'Manrope' }}>"AI SaaS Platforms"</div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-[#adaaaa]">Difficulty</span>
                    <span className="text-[#ff6e84] font-bold">Hard (89)</span>
                  </div>
                  <div className="w-full h-1 bg-[#262626] rounded-full overflow-hidden">
                    <div className="w-[89%] h-full bg-[#ff6e84]" />
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-[#3adffa]/10 border border-[#3adffa]/20">
                  <div className="flex items-center mb-2">
                    <span className="material-symbols-outlined text-[#3adffa] mr-2 text-sm">auto_awesome</span>
                    <span className="text-xs font-bold text-[#3adffa] uppercase">Agent Recommendation</span>
                  </div>
                  <p className="text-[11px] text-[#adaaaa] leading-relaxed">Inject LSI keywords "Machine Learning Deployment" and "No-Code AI" to improve semantic density by 14%.</p>
                </div>
              </div>

              {/* Visualization Area */}
              <div className="md:col-span-2 space-y-8">
                <div className="flex justify-between items-end">
                  <div className="text-left">
                    <div className="text-[10px] text-[#adaaaa] font-bold tracking-widest uppercase mb-1">Live Authority Index</div>
                    <div className="text-4xl font-extrabold text-white" style={{ fontFamily: 'Manrope' }}>84.2 <span className="text-[#3adffa] text-sm font-medium">+12%</span></div>
                  </div>
                  <div className="flex space-x-2">
                    <div className="px-3 py-1 rounded bg-[#262626] text-[10px] text-white">1H</div>
                    <div className="px-3 py-1 rounded bg-[#cc97ff]/20 text-[10px] text-[#cc97ff] font-bold">24H</div>
                    <div className="px-3 py-1 rounded bg-[#262626] text-[10px] text-white">7D</div>
                  </div>
                </div>
                <div className="relative h-48 w-full">
                  {/* Abstract SVG Chart */}
                  <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 400 100">
                    <defs>
                      <linearGradient id="grad-primary" x1="0%" x2="0%" y1="0%" y2="100%">
                        <stop offset="0%" style={{ stopColor: 'rgba(204,151,255,0.4)', stopOpacity: 1 }} />
                        <stop offset="100%" style={{ stopColor: 'rgba(204,151,255,0)', stopOpacity: 0 }} />
                      </linearGradient>
                    </defs>
                    <path d="M0,80 Q50,75 100,50 T200,60 T300,20 T400,10 L400,100 L0,100 Z" fill="url(#grad-primary)" />
                    <path d="M0,80 Q50,75 100,50 T200,60 T300,20 T400,10" fill="none" stroke="#cc97ff" strokeWidth="2" />
                    <circle className="animate-pulse" cx="300" cy="20" fill="#3adffa" r="4" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Bento Grid */}
        <section className="py-24 px-8 max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4" style={{ fontFamily: 'Manrope' }}>Neural Infrastructure</h2>
            <p className="text-[#adaaaa] max-w-xl mx-auto">Engineered to outperform traditional SEO tools through deep semantic understanding and real-time execution.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="group p-10 rounded-2xl glass-card glow-border hover:bg-[#201f1f] transition-all duration-500">
              <div className="w-14 h-14 rounded-xl bg-[#cc97ff]/10 flex items-center justify-center mb-8 border border-[#cc97ff]/20 group-hover:bg-[#cc97ff]/20 transition-colors">
                <span className="material-symbols-outlined text-[#cc97ff] text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>psychology</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-4" style={{ fontFamily: 'Manrope' }}>AI Analysis</h3>
              <p className="text-[#adaaaa] leading-relaxed">Hyper-accurate data ingestion of your competitors' backlink profiles and content architectures. We find the gaps they didn't know existed.</p>
            </div>
            {/* Feature 2 */}
            <div className="group p-10 rounded-2xl glass-card glow-border hover:bg-[#201f1f] transition-all duration-500">
              <div className="w-14 h-14 rounded-xl bg-[#3adffa]/10 flex items-center justify-center mb-8 border border-[#3adffa]/20 group-hover:bg-[#3adffa]/20 transition-colors">
                <span className="material-symbols-outlined text-[#3adffa] text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>auto_fix_high</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-4" style={{ fontFamily: 'Manrope' }}>Auto-Optimization</h3>
              <p className="text-[#adaaaa] leading-relaxed">Our agents push live meta-data and schema updates directly to your CMS, ensuring you are always ahead of the latest algorithm shifts.</p>
            </div>
            {/* Feature 3 */}
            <div className="group p-10 rounded-2xl glass-card glow-border hover:bg-[#201f1f] transition-all duration-500">
              <div className="w-14 h-14 rounded-xl bg-[#ff86c3]/10 flex items-center justify-center mb-8 border border-[#ff86c3]/20 group-hover:bg-[#ff86c3]/20 transition-colors">
                <span className="material-symbols-outlined text-[#ff86c3] text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>query_stats</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-4" style={{ fontFamily: 'Manrope' }}>Predictive Tracking</h3>
              <p className="text-[#adaaaa] leading-relaxed">Utilize machine learning to forecast ranking trends before they happen. Pivot your strategy 30 days ahead of the competition.</p>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 px-8 mb-20">
          <div className="max-w-5xl mx-auto relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#cc97ff]/20 via-[#1a1919] to-[#131313] border border-white/5 p-16 text-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(204,151,255,0.1)_0%,_transparent_70%)] pointer-events-none" />
            <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-6 relative z-10" style={{ fontFamily: 'Manrope' }}>Stop guessing. <br />Start dominating.</h2>
            <p className="text-[#adaaaa] text-lg mb-10 relative z-10">Join 500+ enterprises using Kinetic to automate their organic growth.</p>
            <div className="relative z-10">
              <button className="px-12 py-5 bg-white text-[#0e0e0e] font-black uppercase tracking-tighter rounded-xl hover:bg-[#c284ff] transition-colors shadow-2xl" style={{ fontFamily: 'Manrope' }}>Deploy Agent Now</button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[#0e0e0e] border-t border-white/5 w-full py-12 px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 max-w-7xl mx-auto text-xs text-[#adaaaa]" style={{ fontFamily: 'Inter' }}>
          <div className="space-y-6">
            <div className="text-lg font-black text-white" style={{ fontFamily: 'Manrope' }}>KINETIC</div>
            <p className="leading-relaxed">The future of SEO is autonomous. Kinetic SEO utilizes agentic AI to manage search presence at scale.</p>
          </div>
          <div className="space-y-4">
            <h4 className="text-white font-bold uppercase tracking-widest text-[10px]">Product</h4>
            <ul className="space-y-2">
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Features</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Pricing</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">API Access</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Enterprise</a></li>
            </ul>
          </div>
          <div className="space-y-4">
            <h4 className="text-white font-bold uppercase tracking-widest text-[10px]">Company</h4>
            <ul className="space-y-2">
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">About Us</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Careers</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Blog</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Press Kit</a></li>
            </ul>
          </div>
          <div className="space-y-4">
            <h4 className="text-white font-bold uppercase tracking-widest text-[10px]">Legal</h4>
            <ul className="space-y-2">
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Privacy Policy</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Terms of Service</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Security</a></li>
              <li><a className="hover:text-[#3adffa] transition-colors" href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center opacity-80 text-xs text-[#adaaaa]">
          <div className="mb-4 md:mb-0">&copy; 2024 KINETIC SEO. Powered by Liquid Data.</div>
          <div className="flex space-x-6">
            <a className="hover:text-[#cc97ff] transition-colors" href="#">Twitter</a>
            <a className="hover:text-[#cc97ff] transition-colors" href="#">LinkedIn</a>
            <a className="hover:text-[#cc97ff] transition-colors" href="#">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
