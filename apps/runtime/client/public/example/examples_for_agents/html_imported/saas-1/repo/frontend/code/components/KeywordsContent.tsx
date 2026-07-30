import { React, cn } from '@exepad/sdk';

const keywordData = [
  {
    keyword: 'enterprise seo solutions',
    volume: '42,500',
    cpc: '$24.15',
    difficulty: 82,
    difficultyColor: 'text-[#ff6e84]',
    difficultyGradient: 'from-[#ff6e84]/50 to-[#ff6e84]',
    difficultyShadow: 'shadow-[0_0_10px_rgba(255,110,132,0.3)]',
    trend: [2, 3, 4, 6],
    showNewTabIcon: true,
  },
  {
    keyword: 'best keyword explorer 2024',
    volume: '12,800',
    cpc: '$8.40',
    difficulty: 45,
    difficultyColor: 'text-[#3adffa]',
    difficultyGradient: 'from-[#3adffa]/50 to-[#3adffa]',
    difficultyShadow: 'shadow-[0_0_10px_rgba(58,223,250,0.3)]',
    trend: [4, 5, 4, 6],
    showNewTabIcon: false,
  },
  {
    keyword: 'ai powered backlinks',
    volume: '5,400',
    cpc: '$15.90',
    difficulty: 22,
    difficultyColor: 'text-[#cc97ff]',
    difficultyGradient: 'from-[#cc97ff]/50 to-[#cc97ff]',
    difficultyShadow: 'shadow-[0_0_10px_rgba(204,151,255,0.3)]',
    trend: [1, 3, 5, 6],
    showNewTabIcon: false,
  },
  {
    keyword: 'seo audit checklist',
    volume: '110,000',
    cpc: '$1.20',
    difficulty: 64,
    difficultyColor: 'text-[#3adffa]',
    difficultyGradient: 'from-[#3adffa]/50 to-[#3adffa]',
    difficultyShadow: 'shadow-[0_0_10px_rgba(58,223,250,0.3)]',
    trend: [6, 4, 3, 2],
    showNewTabIcon: false,
  },
];

export default function KeywordsContent({ className }) {
  return (
    <div className={cn('bg-[#0e0e0e] text-white relative', className)} style={{ fontFamily: 'Inter' }}>
      {/* Background Radial Glow */}
      <div className="fixed top-0 right-0 w-[800px] h-[800px] bg-[#9c48ea]/5 rounded-full blur-[120px] -z-10 translate-x-1/2 -translate-y-1/2" />

      {/* Top Navigation Bar (Search & Filter) */}
      <header className="h-24 sticky top-0 z-30 px-10 flex items-center justify-between bg-[#0e0e0e]/80 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center flex-1 max-w-4xl gap-6">
          {/* Search Input Container */}
          <div className="relative group flex-1">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#adaaaa] group-focus-within:text-[#3adffa] transition-colors">search</span>
            <input
              className="w-full h-12 bg-[#262626] border-none rounded-xl pl-12 pr-4 text-sm focus:ring-1 focus:ring-[#3adffa] transition-all placeholder:text-[#adaaaa]/50"
              placeholder="Search Keyword"
              type="text"
            />
          </div>
          {/* Filters Cluster */}
          <div className="flex items-center gap-3">
            <div className="relative group">
              <select className="appearance-none h-12 bg-[#131313] border-none rounded-xl px-4 pr-10 text-xs font-medium text-[#adaaaa] cursor-pointer hover:bg-[#1a1919] transition-colors">
                <option>United States</option>
                <option>United Kingdom</option>
                <option>Germany</option>
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[#adaaaa] pointer-events-none text-sm">expand_more</span>
            </div>
            <div className="relative group">
              <select className="appearance-none h-12 bg-[#131313] border-none rounded-xl px-4 pr-10 text-xs font-medium text-[#adaaaa] cursor-pointer hover:bg-[#1a1919] transition-colors">
                <option>Volume: All</option>
                <option>10k+</option>
                <option>1k - 10k</option>
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[#adaaaa] pointer-events-none text-sm">expand_more</span>
            </div>
            <button className="h-12 w-12 flex items-center justify-center bg-[#131313] rounded-xl text-[#adaaaa] hover:text-white hover:bg-[#1a1919] transition-all">
              <span className="material-symbols-outlined">filter_list</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 ml-8">
          <div className="text-right">
            <p className="text-xs font-bold">Project Alpha</p>
            <p className="text-[10px] text-[#adaaaa]">Command Center</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-[#1a1919] border border-white/10 overflow-hidden">
            <img
              className="w-full h-full object-cover"
              alt="User avatar for profile section"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuAel8QBgO5SD9dER7Vvp8mBihTcorBTejPTYAgYRmFyJRgOYvysX8sIA3Ie7yZT1dgPjcM3IbXqv7b7-I_Sp763O8ir_wdH_qWhnvcn4Me__KnU4QpUHcoszxpFrIXTX6YrMtBALdhbnIU8CWF0zO42ZJEG5BlBTrFg8dFFm6xttsHVjG6KVcN_oC8gmi9Xajr86yS0qyo5pKZOI_8ZmofWGarScLa1wIF1fQt4Ncrrpok8TF5rKluoZkDBd3l6TgMowqUGtEN0Y5do"
            />
          </div>
        </div>
      </header>

      {/* Page Content */}
      <div className="p-10 space-y-10">
        {/* Hero Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-card p-6 rounded-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <span className="material-symbols-outlined text-6xl">trending_up</span>
            </div>
            <p className="text-xs font-medium text-[#adaaaa] uppercase tracking-widest mb-2">Primary Keyword Rank</p>
            <h2 className="text-4xl font-extrabold text-white tracking-tighter" style={{ fontFamily: 'Manrope' }}>#4</h2>
            <div className="mt-4 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-[#3adffa]/10 text-[#3adffa] text-[10px] font-bold">+2 Today</span>
              <span className="text-[10px] text-[#adaaaa] italic">vs last week</span>
            </div>
          </div>
          <div className="glass-card p-6 rounded-xl relative overflow-hidden">
            <p className="text-xs font-medium text-[#adaaaa] uppercase tracking-widest mb-2">Total Monthly Volume</p>
            <h2 className="text-4xl font-extrabold text-white tracking-tighter" style={{ fontFamily: 'Manrope' }}>842.5K</h2>
            <div className="mt-4 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-[#cc97ff]/10 text-[#cc97ff] text-[10px] font-bold">Stable</span>
              <span className="text-[10px] text-[#adaaaa] italic">Aggregated data</span>
            </div>
          </div>
          <div className="glass-card p-6 rounded-xl relative overflow-hidden">
            <p className="text-xs font-medium text-[#adaaaa] uppercase tracking-widest mb-2">Avg. CPC Opportunity</p>
            <h2 className="text-4xl font-extrabold text-white tracking-tighter" style={{ fontFamily: 'Manrope' }}>$12.40</h2>
            <div className="mt-4 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-[#ff86c3]/10 text-[#ff86c3] text-[10px] font-bold">High ROI</span>
              <span className="text-[10px] text-[#adaaaa] italic">Targeted leads</span>
            </div>
          </div>
        </div>

        {/* Main Data Section */}
        <section className="space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <h3 className="text-2xl font-bold text-white tracking-tight" style={{ fontFamily: 'Manrope' }}>Keyword Analytics</h3>
              <p className="text-sm text-[#adaaaa] mt-1">Deep analysis of the top 25 high-intent keywords for your project.</p>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-[#cc97ff] hover:text-white transition-colors">
              <span className="material-symbols-outlined text-sm">download</span> Export CSV
            </button>
          </div>

          {/* Table Container */}
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#131313]/50">
                  <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-[#adaaaa] border-b border-white/5">Keyword</th>
                  <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-[#adaaaa] border-b border-white/5 text-right">Volume</th>
                  <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-[#adaaaa] border-b border-white/5 text-right">CPC (USD)</th>
                  <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-[#adaaaa] border-b border-white/5">Difficulty</th>
                  <th className="px-8 py-5 text-[10px] font-bold uppercase tracking-widest text-[#adaaaa] border-b border-white/5 text-center">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {keywordData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-white/5 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-white group-hover:text-[#cc97ff] transition-colors">{row.keyword}</span>
                        {row.showNewTabIcon && (
                          <span className="material-symbols-outlined text-[14px] text-[#adaaaa] opacity-0 group-hover:opacity-100 transition-opacity">open_in_new</span>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right font-bold" style={{ fontFamily: 'Manrope' }}>{row.volume}</td>
                    <td className="px-8 py-6 text-right font-medium">{row.cpc}</td>
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-1.5 bg-[#262626] rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-gradient-to-r ${row.difficultyGradient} ${row.difficultyShadow}`}
                            style={{ width: `${row.difficulty}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold ${row.difficultyColor} min-w-[28px]`}>{row.difficulty}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex justify-center">
                        <div className="w-12 h-6 flex items-end gap-1">
                          {row.trend.map((h, i) => (
                            <div
                              key={i}
                              className={`w-1 rounded-t-sm ${i === row.trend.length - 1 ? 'bg-[#3adffa]' : `bg-[#3adffa]/${i === 0 ? (row.trend[0] <= 2 ? '10' : '20') : (i === 1 ? (row.trend.length === 4 ? '30' : '40') : '50')}`}`}
                              style={{ height: `${h * 4}px` }}
                            />
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination / Footer of Table */}
            <div className="px-8 py-4 flex items-center justify-between bg-[#131313]/30 text-[10px] font-bold text-[#adaaaa] uppercase tracking-widest">
              <p>Showing 1-10 of 254 Keywords</p>
              <div className="flex items-center gap-4">
                <button className="flex items-center gap-1 hover:text-white transition-colors disabled:opacity-30" disabled>
                  <span className="material-symbols-outlined text-sm">chevron_left</span> Previous
                </button>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 flex items-center justify-center bg-[#cc97ff] text-black rounded">1</span>
                  <span className="w-6 h-6 flex items-center justify-center hover:bg-white/5 rounded cursor-pointer transition-colors">2</span>
                  <span className="w-6 h-6 flex items-center justify-center hover:bg-white/5 rounded cursor-pointer transition-colors">3</span>
                </div>
                <button className="flex items-center gap-1 hover:text-white transition-colors">
                  Next <span className="material-symbols-outlined text-sm">chevron_right</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Sticky Floating AI Assistant Trigger */}
      <button className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-gradient-to-tr from-[#3adffa] to-[#48e4ff] shadow-[0_0_30px_rgba(58,223,250,0.3)] flex items-center justify-center text-[#003a43] z-50 hover:scale-110 active:scale-95 transition-transform">
        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
      </button>

      {/* Global Footer */}
      <footer className="w-full py-12 px-10 bg-[#0e0e0e] border-t border-white/5 mt-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-1">
            <span className="text-lg font-black text-white tracking-tighter" style={{ fontFamily: 'Manrope' }}>KINETIC</span>
            <p className="mt-4 text-xs text-[#adaaaa] leading-relaxed" style={{ fontFamily: 'Inter' }}>
              Precision SEO intelligence powered by Liquid Data. Real-time insights for the modern digital alchemist.
            </p>
          </div>
          <div className="flex flex-col space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white mb-2">Platform</p>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">Keyword Research</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">Competitor Analysis</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">Rank Tracking</a>
          </div>
          <div className="flex flex-col space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white mb-2">Resources</p>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">SEO Guide</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">API Documentation</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">Case Studies</a>
          </div>
          <div className="flex flex-col space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white mb-2">Legal</p>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">Privacy Policy</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">Terms of Service</a>
            <a className="text-xs text-[#adaaaa] hover:text-[#3adffa] transition-colors" style={{ fontFamily: 'Inter' }} href="#">Contact Support</a>
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-[#adaaaa]" style={{ fontFamily: 'Inter' }}>&copy; 2024 KINETIC SEO. Powered by Liquid Data.</p>
          <div className="flex gap-6">
            <span className="material-symbols-outlined text-[#adaaaa] hover:text-white cursor-pointer transition-colors text-sm">terminal</span>
            <span className="material-symbols-outlined text-[#adaaaa] hover:text-white cursor-pointer transition-colors text-sm">public</span>
            <span className="material-symbols-outlined text-[#adaaaa] hover:text-white cursor-pointer transition-colors text-sm">rss_feed</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
