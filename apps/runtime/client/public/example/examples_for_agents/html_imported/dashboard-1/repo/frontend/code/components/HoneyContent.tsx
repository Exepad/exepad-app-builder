import { React, Charts, cn, navigate, useModel, useHandler, useCurrentUser, toast } from '@exepad/sdk';
const { useState } = React;

const gradeStyles: Record<string, { gradeColor: string; dotColor: string }> = {
  'Grade A+': { gradeColor: 'bg-[#a0f399]/30 text-[#217128]', dotColor: 'bg-[#1b6d24]' },
  'Grade A': { gradeColor: 'bg-[#a0f399]/30 text-[#217128]', dotColor: 'bg-[#1b6d24]' },
  'Grade B': { gradeColor: 'bg-[#dcb530]/20 text-[#5a4700]', dotColor: 'bg-[#735c00]' },
};

const PAGE_SIZE = 10;

export default function HoneyContent({ className }) {
  const user = useCurrentUser();
  const [chartPeriod, setChartPeriod] = useState<string>('yearly');
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const [editingHarvest, setEditingHarvest] = useState<any>(null);
  const [page, setPage] = useState(0);

  const production = useHandler('getProductionTrend', { params: { period: chartPeriod }, autoFetch: true });
  const { data: harvests, remove } = useModel('harvest_logs', { orderBy: { harvested_at: 'desc' }, limit: PAGE_SIZE, offset: page * PAGE_SIZE });

  const chartData = (production.data?.data || []).map((d: any) => ({ month: d.label, yield: d.volume }));
  const totalYield = production.data?.totalYield ?? 0;
  const avgPerHive = production.data?.avgPerHive ?? 0;
  const yoyChange = production.data?.yoyChange ?? 0;

  const ledgerRows = (harvests || []).map((h: any) => {
    const style = gradeStyles[h.quality_grade] || gradeStyles['Grade B'];
    return {
      id: h.id,
      date: new Date(h.harvested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      hiveId: h.hive_id,
      quantity: h.quantity_kg,
      grade: h.quality_grade,
      collector: h.collector || 'Unknown',
      ...style,
    };
  });

  return (
    <div className={cn('bg-[#f7f9ff] text-[#181c20] min-h-full', className)} style={{ fontFamily: 'Inter' }}>
      {/* TopAppBar */}
      <header className="w-full sticky top-0 z-40 bg-slate-50/70 backdrop-blur-md shadow-sm border-b border-slate-200/50">
        <div className="flex justify-between items-center px-6 py-3 w-full">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
              <input className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-[#835400]/20 transition-all" placeholder="Search harvests..." type="text" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button className="p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95">
              <span className="material-symbols-outlined">history</span>
            </button>
            <div className="h-8 w-[1px] bg-slate-200 mx-2" />
            <div className="flex items-center gap-3 pl-2">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-[#181c20] leading-none">{user?.name || user?.email || 'User'}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-[#ffddb5] flex items-center justify-center font-bold text-[#835400] text-sm border-2 border-[#ffddb5]">{(user?.name || user?.email || 'U')[0].toUpperCase()}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <div className="p-6 lg:p-10 space-y-10">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h2 className="font-extrabold text-3xl text-[#181c20] tracking-tight mb-2" style={{ fontFamily: 'Manrope' }}>Honey Production Logs</h2>
            <p className="text-[#524434] max-w-2xl">A comprehensive ledger of every harvest. Track yields, monitor quality trends, and forecast upcoming production cycles across all managed apiaries.</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="bg-white text-[#181c20] px-4 py-2.5 rounded-lg font-medium text-sm flex items-center gap-2 border border-[#d7c3ae]/20 shadow-sm hover:bg-[#f1f4fa] transition-colors">
              <span className="material-symbols-outlined text-[18px]">filter_list</span>
              Filter
            </button>
            <button className="bg-[#835400] text-white px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 shadow-md hover:opacity-95 transition-opacity" onClick={() => {
              const csv = ['Date,Hive ID,Quantity (kg),Grade,Collector',
                ...ledgerRows.map((r: any) => `${r.date},${r.hiveId},${r.quantity},${r.grade},${r.collector}`)
              ].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'harvest_logs.csv';
              a.click();
              toast('CSV exported', 'success');
            }}>
              <span className="material-symbols-outlined text-[18px]">download</span>
              Export CSV
            </button>
          </div>
        </div>

        {/* Quick Stats Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl">equalizer</span>
            </div>
            <p className="text-xs font-bold text-[#524434] tracking-[0.05em] mb-1">TOTAL SEASON YIELD</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>{totalYield.toLocaleString()}</span>
              <span className="text-[#524434] font-medium text-lg">kg</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[#1b6d24] font-semibold text-sm">
              <span className="material-symbols-outlined text-[18px]">trending_up</span>
              <span>{yoyChange}% increase from last year</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl">analytics</span>
            </div>
            <p className="text-xs font-bold text-[#524434] tracking-[0.05em] mb-1">AVG YIELD PER HIVE</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>{avgPerHive}</span>
              <span className="text-[#524434] font-medium text-lg">kg</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[#735c00] font-semibold text-sm">
              <span className="material-symbols-outlined text-[18px]">remove</span>
              <span>Average per hive this season</span>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl border-l-4 border-[#f9a825] relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl">event</span>
            </div>
            <p className="text-xs font-bold text-[#524434] tracking-[0.05em] mb-1">EST. NEXT HARVEST</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>Oct 14</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[#524434] font-semibold text-sm">
              <span className="material-symbols-outlined text-[18px]">timer</span>
              <span>Approximately 18 days left</span>
            </div>
          </div>
        </div>

        {/* Harvest Performance Chart */}
        <div className="bg-[#f1f4fa] rounded-2xl p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-bold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>Harvest Performance</h3>
              <p className="text-sm text-[#524434]">Monthly honey production volumes (kg)</p>
            </div>
            <div className="flex bg-white p-1 rounded-lg border border-[#d7c3ae]/20">
              <button className={cn('px-4 py-1.5 text-sm font-semibold rounded-md', chartPeriod === 'yearly' ? 'bg-[#835400] text-white shadow-sm' : 'text-[#524434] hover:text-[#181c20]')} onClick={() => setChartPeriod('yearly')}>Monthly</button>
              <button className={cn('px-4 py-1.5 text-sm font-medium rounded-md', chartPeriod === '90d' ? 'bg-[#835400] text-white shadow-sm' : 'text-[#524434] hover:text-[#181c20]')} onClick={() => setChartPeriod('90d')}>Quarterly</button>
            </div>
          </div>
          <div className="h-[320px] w-full">
            <Charts.ResponsiveContainer width="100%" height="100%">
              <Charts.BarChart data={chartData} margin={{ top: 20, right: 10, left: -10, bottom: 5 }}>
                <Charts.XAxis dataKey="month" tick={{ fontSize: 10, fill: '#524434', fontWeight: 700 }} tickLine={false} axisLine={false} />
                <Charts.YAxis tick={{ fontSize: 10, fill: '#524434' }} tickLine={false} axisLine={false} tickFormatter={(value: number) => `${value}kg`} />
                <Charts.Tooltip contentStyle={{ backgroundColor: '#181c20', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, color: '#f7f9ff' }} formatter={(value: number) => [`${value} kg`, 'Yield']} cursor={{ fill: 'rgba(131, 84, 0, 0.05)' }} />
                <Charts.Bar dataKey="yield" fill="#835400" opacity={0.25} radius={[6, 6, 0, 0]} />
              </Charts.BarChart>
            </Charts.ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Harvest Ledger Table */}
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#ebeef4] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>Detailed Harvest Ledger</h3>
            <div className="flex items-center gap-4">
              <div className="relative">
                <input className="pl-9 pr-4 py-1.5 bg-[#e5e8ee]/50 border-none rounded-lg text-sm focus:ring-1 focus:ring-[#835400] w-full md:w-48 placeholder-[#524434]/70" placeholder="Filter by collector..." type="text" />
                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[#524434] text-[18px]">search</span>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f1f4fa]/50">
                  <th className="px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider">Date</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider">Hive ID</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider">Quantity (kg)</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider">Quality Grade</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider">Collector</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ebeef4]">
                {ledgerRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-[#f1f4fa]/30 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-[#181c20]">{row.date}</td>
                    <td className="px-6 py-4"><span className="bg-[#dfe3e8] px-2 py-1 rounded text-xs font-bold text-[#524434]">{row.hiveId}</span></td>
                    <td className="px-6 py-4 text-sm font-bold text-[#181c20]">{row.quantity}</td>
                    <td className="px-6 py-4">
                      <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold', row.gradeColor)}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', row.dotColor)} />
                        {row.grade}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-[#e5e8ee] flex items-center justify-center">
                          <span className="material-symbols-outlined text-[14px]">person</span>
                        </div>
                        <span className="text-sm font-medium text-[#181c20]">{row.collector}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="relative">
                        <button onClick={() => setOpenRowMenu(openRowMenu === row.id ? null : row.id)} className="text-[#524434] hover:text-[#835400] transition-colors">
                          <span className="material-symbols-outlined">more_horiz</span>
                        </button>
                        {openRowMenu === row.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-[#d7c3ae]/20 py-1 z-50 min-w-[120px]">
                            <button onClick={() => { setEditingHarvest(row); setOpenRowMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-[#f1f4fa]">Edit</button>
                            <button onClick={async () => { await remove(row.id); toast('Harvest deleted', 'success'); setOpenRowMenu(null); }} className="w-full text-left px-4 py-2 text-sm hover:bg-[#ffdad6]/30 text-[#ba1a1a]">Delete</button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 flex items-center justify-between bg-[#f1f4fa]/20">
            <p className="text-xs text-[#524434] font-medium">Showing page {page + 1} ({ledgerRows.length} entries)</p>
            <div className="flex gap-2">
              <button className="p-1.5 rounded-md border border-[#d7c3ae]/20 hover:bg-[#ebeef4] text-[#524434] transition-colors" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} style={page === 0 ? { opacity: 0.5 } : {}}>
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <button className="p-1.5 rounded-md border border-[#d7c3ae]/20 hover:bg-[#ebeef4] text-[#524434] transition-colors" disabled={ledgerRows.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)} style={ledgerRows.length < PAGE_SIZE ? { opacity: 0.5 } : {}}>
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#f7f9ff]/90 backdrop-blur-md border-t border-[#d7c3ae]/20 flex justify-around py-4 z-50">
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/')}>
          <span className="material-symbols-outlined">dashboard</span>
          <span className="text-[10px] font-bold">Home</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/hives')}>
          <span className="material-symbols-outlined">grid_view</span>
          <span className="text-[10px] font-bold">Hives</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#835400]" onClick={() => navigate('/honey-production')}>
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>water_drop</span>
          <span className="text-[10px] font-bold">Yield</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/pest-control')}>
          <span className="material-symbols-outlined">bug_report</span>
          <span className="text-[10px] font-bold">Pests</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/settings')}>
          <span className="material-symbols-outlined">settings</span>
          <span className="text-[10px] font-bold">Menu</span>
        </button>
      </nav>
    </div>
  );
}
