import { React, cn } from '@exepad/sdk';

export default function OverviewContent({ className }) {
  return (
    <div className={cn('bg-[#0e0e0e] text-white', className)} style={{ fontFamily: 'Inter' }}>
      {/* Main Content Canvas */}
      <div className="p-6 lg:p-10">
        {/* Header Section */}
        <header className="flex justify-between items-end mb-12">
          <div>
            <h1 className="text-4xl font-extrabold text-white tracking-tighter mb-2" style={{ fontFamily: 'Manrope' }}>Command Center</h1>
            <p className="text-[#adaaaa] font-medium">Monitoring <span className="text-[#3adffa]">project-alpha.kinetic.io</span> in real-time.</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex -space-x-2">
              <img className="w-10 h-10 rounded-full border-2 border-[#0e0e0e]" alt="User avatar 1" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAcdWDhUzkq5Ak4j1yLUjYX0-VaDjUaPJtPyTYz6Se0dekRBQJQa6SID2M3YTBys48xLEBDCZgXLp92_XBv7mEgCAeilhmxJY3w2ni5xPOaIEklzYae4nqQ3zOL1IQpyLlnjVFkhPwtZLEbxQUrjdwTLRTwP8QGcefLnwH3bjy7JbPeS42N_A70_i07jJkFB2G6DRNjxFkCWIoqBXBcSood8KWZWfLM5tpwLVEDGEagZHq-XHGF_Y3HZkBEUrRmS3q6at89cUZhRBIx" />
              <img className="w-10 h-10 rounded-full border-2 border-[#0e0e0e]" alt="User avatar 2" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAGYNijBUuspSTskON2785Y02JD2-FwLlnIoAIRtTSct91CGLczw_bMUQ2fwswwdAcwJYyO4rPG-afni8a9qGoORRUX2ErepDZSzxDTJ7XHIszAwupt-DNCDGUsQtH_dKsKo9cELGigwRSP5m_iZo8XX7P0E10eNabYbM2sWM5htJvqh1Exia8f-yTvF6l-Fk6-7GVXEvEngViuzib80Z3CVPfMGNbW9CxPsUKEpGdA6jeX5heRkGIP6cqb1RK097koMXguTjnA5adp" />
            </div>
            <div className="h-10 w-px bg-white/10" />
            <button className="bg-[#201f1f] px-4 py-2 rounded-lg text-sm font-semibold flex items-center space-x-2 border border-white/5 hover:bg-[#2c2c2c] transition-colors">
              <span className="material-symbols-outlined text-lg">calendar_today</span>
              <span>Last 30 Days</span>
            </button>
          </div>
        </header>

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-12 gap-6">
          {/* Site Health Card */}
          <div className="col-span-12 md:col-span-4 glass-card p-8 rounded-2xl ambient-glow">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-[#adaaaa] text-xs uppercase tracking-widest font-bold mb-1">Site Health</p>
                <h2 className="text-3xl font-extrabold text-[#3adffa]" style={{ fontFamily: 'Manrope' }}>94%</h2>
              </div>
              <div className="bg-[#006877]/10 p-2 rounded-full">
                <span className="material-symbols-outlined text-[#3adffa]" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
              </div>
            </div>
            <div className="h-24 flex items-end space-x-1">
              <div className="w-full bg-[#3adffa]/20 h-12 rounded-t-sm" />
              <div className="w-full bg-[#3adffa]/20 h-16 rounded-t-sm" />
              <div className="w-full bg-[#3adffa]/40 h-20 rounded-t-sm" />
              <div className="w-full bg-[#3adffa]/60 h-24 rounded-t-sm" />
              <div className="w-full bg-[#3adffa] h-22 rounded-t-sm shadow-[0_0_15px_rgba(58,223,250,0.3)]" />
              <div className="w-full bg-[#3adffa]/80 h-18 rounded-t-sm" />
            </div>
            <p className="mt-4 text-xs text-[#adaaaa]">+2.4% from last audit</p>
          </div>

          {/* Keywords Ranked Card */}
          <div className="col-span-12 md:col-span-4 glass-card p-8 rounded-2xl ambient-glow">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-[#adaaaa] text-xs uppercase tracking-widest font-bold mb-1">Keywords Ranked</p>
                <h2 className="text-3xl font-extrabold text-[#cc97ff]" style={{ fontFamily: 'Manrope' }}>1,284</h2>
              </div>
              <div className="bg-[#c284ff]/10 p-2 rounded-full">
                <span className="material-symbols-outlined text-[#cc97ff]">search</span>
              </div>
            </div>
            <div className="h-24 relative flex items-center">
              <svg className="w-full h-full" viewBox="0 0 100 40">
                <path className="text-[#cc97ff]" d="M0 35 Q 25 35, 40 20 T 80 10 T 100 5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M0 35 Q 25 35, 40 20 T 80 10 T 100 5 V 40 H 0 Z" fill="url(#purpleGradient)" opacity="0.1" />
                <defs>
                  <linearGradient id="purpleGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#cc97ff" />
                    <stop offset="100%" stopColor="transparent" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div className="mt-4 flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded-full bg-[#006877]/10 text-[#3adffa] text-[10px] font-bold">TOP 3: 42</span>
              <span className="px-2 py-0.5 rounded-full bg-[#262626] text-[#adaaaa] text-[10px] font-bold">TOP 10: 184</span>
            </div>
          </div>

          {/* Organic Traffic Card */}
          <div className="col-span-12 md:col-span-4 glass-card p-8 rounded-2xl ambient-glow">
            <div className="flex justify-between items-start mb-6">
              <div>
                <p className="text-[#adaaaa] text-xs uppercase tracking-widest font-bold mb-1">Organic Traffic</p>
                <h2 className="text-3xl font-extrabold text-[#ff86c3]" style={{ fontFamily: 'Manrope' }}>42.5k</h2>
              </div>
              <div className="bg-[#f673b7]/10 p-2 rounded-full">
                <span className="material-symbols-outlined text-[#ff86c3]">trending_up</span>
              </div>
            </div>
            <div className="h-24 flex items-center justify-center">
              <div className="w-full h-1 bg-[#262626] rounded-full overflow-hidden">
                <div className="h-full bg-[#ff86c3] w-3/4 shadow-[0_0_10px_rgba(255,134,195,0.4)]" />
              </div>
            </div>
            <p className="mt-4 text-xs text-[#adaaaa]">Targeting 50k by October</p>
          </div>

          {/* AI Insights Panel */}
          <div className="col-span-12 md:col-span-8 glass-card p-10 rounded-2xl min-h-[400px]">
            <div className="flex items-center space-x-3 mb-8">
              <div className="relative">
                <span className="material-symbols-outlined text-[#cc97ff] text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>psychology</span>
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#3adffa] rounded-full animate-pulse border-2 border-[#0e0e0e]" />
              </div>
              <h3 className="text-2xl font-extrabold tracking-tight" style={{ fontFamily: 'Manrope' }}>AI Kinetic Insights</h3>
            </div>
            <div className="space-y-6">
              <div className="group p-6 bg-[#131313] rounded-xl border-l-4 border-[#cc97ff] hover:bg-[#1a1919] transition-all">
                <div className="flex justify-between mb-2">
                  <span className="text-[#cc97ff] font-bold text-xs uppercase tracking-widest">High Impact</span>
                  <span className="text-[#adaaaa] text-xs">2 hours ago</span>
                </div>
                <h4 className="text-lg font-bold mb-2">Optimize Content for "Semantic SEO"</h4>
                <p className="text-[#adaaaa] text-sm leading-relaxed">Your ranking for "SEO automation" has dipped. Adding LSI keywords like "neural matching" and "entity-based search" could recover your #2 position.</p>
                <div className="mt-4 flex space-x-3">
                  <button className="text-[#cc97ff] text-sm font-bold border-b border-[#cc97ff]/20 hover:border-[#cc97ff] transition-all pb-1">Apply Optimization</button>
                  <button className="text-[#adaaaa] text-sm font-medium hover:text-white transition-colors">Dismiss</button>
                </div>
              </div>
              <div className="group p-6 bg-[#131313] rounded-xl border-l-4 border-[#3adffa] hover:bg-[#1a1919] transition-all">
                <div className="flex justify-between mb-2">
                  <span className="text-[#3adffa] font-bold text-xs uppercase tracking-widest">Growth Opportunity</span>
                  <span className="text-[#adaaaa] text-xs">5 hours ago</span>
                </div>
                <h4 className="text-lg font-bold mb-2">Internal Link Structure Audit</h4>
                <p className="text-[#adaaaa] text-sm leading-relaxed">We detected 14 high-authority pages that aren't linking to your new "AI Strategy" pillar page. Automated linking is ready for review.</p>
                <div className="mt-4 flex space-x-3">
                  <button className="text-[#3adffa] text-sm font-bold border-b border-[#3adffa]/20 hover:border-[#3adffa] transition-all pb-1">Review Links</button>
                </div>
              </div>
            </div>
          </div>

          {/* Side Metrics / Recent Activities */}
          <div className="col-span-12 md:col-span-4 flex flex-col space-y-6">
            <div className="glass-card p-6 rounded-2xl flex-1">
              <h3 className="font-bold text-lg mb-4" style={{ fontFamily: 'Manrope' }}>Competitor Pulse</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center font-bold text-[10px]">SV</div>
                    <span className="text-sm font-medium">SearchVoice.io</span>
                  </div>
                  <span className="text-[#ff6e84] text-xs font-bold">-12%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center font-bold text-[10px]">LX</div>
                    <span className="text-sm font-medium">LinkXpert</span>
                  </div>
                  <span className="text-[#3adffa] text-xs font-bold">+5%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center font-bold text-[10px]">AD</div>
                    <span className="text-sm font-medium">AutoData</span>
                  </div>
                  <span className="text-[#adaaaa] text-xs font-bold">0%</span>
                </div>
              </div>
              <button className="w-full mt-6 py-2 border border-white/5 rounded-lg text-xs font-bold hover:bg-white/5 transition-colors">Full Comparison</button>
            </div>
            <div className="glass-card p-6 rounded-2xl bg-gradient-to-br from-[#cc97ff]/10 to-transparent">
              <div className="flex items-center space-x-2 text-[#cc97ff] mb-2">
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                <span className="text-[10px] font-bold uppercase tracking-widest">System Status</span>
              </div>
              <h4 className="font-bold text-lg leading-tight" style={{ fontFamily: 'Manrope' }}>Liquid Data Indexing Active</h4>
              <p className="text-xs text-[#adaaaa] mt-2">Next global crawl scheduled in 42 minutes.</p>
            </div>
          </div>
        </div>

        {/* Space for breathing */}
        <div className="h-20" />

        {/* Minimal Footer within Canvas */}
        <footer className="mt-auto border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
          <div className="flex items-center space-x-6">
            <span className="font-black text-white text-lg" style={{ fontFamily: 'Manrope' }}>KINETIC</span>
            <p className="text-xs text-[#adaaaa]">&copy; 2024 KINETIC SEO. Powered by Liquid Data.</p>
          </div>
          <div className="flex space-x-6">
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Privacy Policy</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Terms of Service</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Security</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" href="#">Contact</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
