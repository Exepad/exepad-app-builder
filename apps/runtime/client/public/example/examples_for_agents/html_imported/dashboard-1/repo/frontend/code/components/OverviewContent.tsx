import { React, Charts, cn, navigate, useModel, useHandler, useCurrentUser } from '@exepad/sdk';
const { useState, useEffect } = React;

const severityStyles = {
  critical: { dotColor: 'bg-[#ba1a1a]', status: 'URGENT TREATMENT', statusBg: 'bg-[#ffdad6]', statusText: 'text-[#93000a]' },
  high: { dotColor: 'bg-[#ba1a1a]', status: 'ACTION REQUIRED', statusBg: 'bg-[#ffdad6]', statusText: 'text-[#93000a]' },
  medium: { dotColor: 'bg-[#735c00]', status: 'MONITORING', statusBg: 'bg-[#dcb530]/30', statusText: 'text-[#5a4700]' },
  low: { dotColor: 'bg-[#1b6d24]', status: 'LOW RISK', statusBg: 'bg-[#a0f399]/30', statusText: 'text-[#217128]' },
};

export default function OverviewContent({ className }) {
  const user = useCurrentUser();
  const overview = useHandler('getDashboardOverview', { autoFetch: true });
  const production = useHandler('getProductionTrend', { params: { period: '30d' }, autoFetch: true });
  const { data: hives } = useModel('hives', { limit: 4, orderBy: { name: 'asc' } });
  const { data: alerts } = useModel('pest_alerts', { filters: { status: 'active' }, orderBy: { detected_at: 'desc' }, limit: 5 });

  const kpis = overview.data || {};
  const chartData = (production.data?.data || []).map((d: any) => ({ day: `Day ${d.label}`, volume: d.volume }));
  const pestAlerts = (alerts || []).map((a: any) => {
    const style = severityStyles[a.severity] || severityStyles.medium;
    const hive = (hives || []).find((h: any) => h.id === a.hive_id);
    return { date: new Date(a.detected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), hive: hive?.name || 'Unknown', pest: a.pest_type, ...style };
  });
  const firstHive = hives?.[0];
  const secondHive = hives?.[1];

  return (
    <div className={cn('bg-[#f7f9ff] text-[#181c20] min-h-full', className)} style={{ fontFamily: 'Inter' }}>
      {/* TopAppBar */}
      <header className="w-full sticky top-0 z-40 bg-slate-50/70 backdrop-blur-md shadow-sm border-b border-slate-200/50">
        <div className="flex justify-between items-center px-6 py-3 w-full">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
              <input
                className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-[#835400]/20 transition-all"
                placeholder="Search apiary logs..."
                type="text"
              />
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
                <p className="text-[10px] text-[#524434] uppercase tracking-tighter">Apiarist</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-[#ffddb5] flex items-center justify-center font-bold text-[#835400] text-sm border-2 border-[#ffddb5]">{(user?.name || user?.email || 'U')[0].toUpperCase()}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Dashboard Canvas */}
      <div className="p-6 lg:p-10 space-y-10">
        {/* Summary Bento Grid */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <div>
              <h2 className="font-extrabold text-3xl text-[#181c20] tracking-tight" style={{ fontFamily: 'Manrope' }}>
                Apiary Harvest Ledger
              </h2>
              <p className="text-[#524434]">Real-time vitals for {kpis.totalHives || 0} active colonies</p>
            </div>
            <div className="flex gap-2">
              <span className={cn('inline-flex items-center px-3 py-1 rounded-full text-xs font-bold gap-1', (kpis.activeAlerts || 0) > 0 ? 'bg-[#ffdad6] text-[#93000a]' : 'bg-[#a0f399] text-[#217128]')}>
                <span className={cn('w-2 h-2 rounded-full', (kpis.activeAlerts || 0) > 0 ? 'bg-[#ba1a1a]' : 'bg-[#1b6d24]')} />
                {(kpis.activeAlerts || 0) > 0 ? `${kpis.activeAlerts} Alert${kpis.activeAlerts > 1 ? 's' : ''} Active` : 'All Systems Optimal'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Hive Health Status */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#d7c3ae]/10 relative overflow-hidden group hover:shadow-md transition-all">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#1b6d24]/5 rounded-full blur-2xl group-hover:bg-[#1b6d24]/10 transition-colors" />
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-[#a0f399]/50 rounded-lg">
                  <span className="material-symbols-outlined text-[#217128]">health_and_safety</span>
                </div>
                <span className="text-[10px] font-bold text-[#1b6d24] uppercase tracking-widest">Live Status</span>
              </div>
              <h3 className="font-bold text-[#524434] text-sm mb-2" style={{ fontFamily: 'Manrope' }}>Hive Health Status</h3>
              <div className="space-y-2">
                {(hives || []).slice(0, 3).map((h: any) => (
                  <div key={h.id} className="flex justify-between items-center">
                    <span className="text-xs font-medium">{h.name}</span>
                    <span className={cn('text-[10px] px-2 py-0.5 rounded font-bold',
                      h.status === 'Thriving' ? 'bg-[#1b6d24]/10 text-[#1b6d24]' :
                      h.status === 'Alert' ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]' :
                      'bg-[#735c00]/10 text-[#735c00]'
                    )}>{h.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Honey Production Progress */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#d7c3ae]/10 relative overflow-hidden group hover:shadow-md transition-all">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-[#f9a825]/50 rounded-lg">
                  <span className="material-symbols-outlined text-[#674100]">opacity</span>
                </div>
                <span className="text-[10px] font-bold text-[#835400] uppercase tracking-widest">Season Yield</span>
              </div>
              <h3 className="font-bold text-[#524434] text-sm mb-1" style={{ fontFamily: 'Manrope' }}>Honey Production</h3>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-2xl font-black text-[#181c20] tracking-tight">{kpis.honeyTargetPercent || 0}%</span>
                <span className="text-xs text-[#524434]">of target</span>
              </div>
              <div className="w-full h-2 bg-[#dfe3e8] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#835400] to-[#f9a825] rounded-full" style={{ width: `${kpis.honeyTargetPercent || 0}%` }} />
              </div>
            </div>

            {/* Pest Alerts */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#d7c3ae]/10 relative overflow-hidden group hover:shadow-md transition-all">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-[#dcb530]/50 rounded-lg">
                  <span className="material-symbols-outlined text-[#5a4700]">bug_report</span>
                </div>
                <span className="text-[10px] font-bold text-[#735c00] uppercase tracking-widest">Biosecurity</span>
              </div>
              <h3 className="font-bold text-[#524434] text-sm mb-1" style={{ fontFamily: 'Manrope' }}>Active Pest Alerts</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-[#ba1a1a]">{kpis.activeAlerts || 0}</span>
                <span className="text-xs text-[#524434] font-medium leading-tight">
                  Critical interventions<br />required
                </span>
              </div>
            </div>

            {/* Queen Bee Status */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#d7c3ae]/10 relative overflow-hidden group hover:shadow-md transition-all">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-[#a0f399]/50 rounded-lg">
                  <span className="material-symbols-outlined text-[#217128]">auto_awesome</span>
                </div>
                <span className="text-[10px] font-bold text-[#1b6d24] uppercase tracking-widest">Regal Vitals</span>
              </div>
              <h3 className="font-bold text-[#524434] text-sm mb-1" style={{ fontFamily: 'Manrope' }}>Queen Bee Presence</h3>
              <div className="flex items-center gap-2 mt-2">
                {(() => {
                  const queens = (hives || []).filter((h: any) => h.queen_name);
                  return <>
                    <div className="flex -space-x-2">
                      {queens.slice(0, 3).map((h: any, i: number) => (
                        <div key={h.id} className="w-8 h-8 rounded-full border-2 border-white bg-[#ffddb5] flex items-center justify-center font-bold text-[10px]">{h.name[h.name.length - 1]}</div>
                      ))}
                    </div>
                    <span className="text-sm font-bold text-[#1b6d24]">{queens.length > 0 ? `${queens.length} Active` : 'None confirmed'}</span>
                  </>;
                })()}
              </div>
            </div>
          </div>
        </section>

        {/* Main Insights Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Indicators & Chart */}
          <div className="lg:col-span-2 space-y-8">
            {/* Indicators Grid */}
            <div>
              <h3 className="font-bold text-[#181c20] text-lg mb-6 flex items-center gap-2" style={{ fontFamily: 'Manrope' }}>
                <span className="w-1 h-6 bg-[#835400] rounded-full" />
{firstHive?.name || 'Hive'} Health Indicators
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-[#f1f4fa] p-4 rounded-xl border border-transparent hover:border-[#d7c3ae]/30 transition-all">
                  <p className="text-[10px] font-bold text-[#524434] uppercase mb-2">Temp</p>
                  <p className="text-xl font-black text-[#181c20]">{firstHive?.temperature ?? '—'}°C</p>
                  <p className={cn('text-[10px] font-bold flex items-center gap-1', (firstHive?.temperature ?? 35) >= 33 && (firstHive?.temperature ?? 35) <= 37 ? 'text-[#1b6d24]' : 'text-[#ba1a1a]')}>
                    <span className="material-symbols-outlined text-[12px]">{(firstHive?.temperature ?? 35) >= 33 && (firstHive?.temperature ?? 35) <= 37 ? 'trending_up' : 'warning'}</span>
                    {(firstHive?.temperature ?? 35) >= 33 && (firstHive?.temperature ?? 35) <= 37 ? 'Optimal' : 'Out of Range'}
                  </p>
                </div>
                <div className="bg-[#f1f4fa] p-4 rounded-xl border border-transparent hover:border-[#d7c3ae]/30 transition-all">
                  <p className="text-[10px] font-bold text-[#524434] uppercase mb-2">Humidity</p>
                  <p className="text-xl font-black text-[#181c20]">{firstHive?.humidity ?? '—'}%</p>
                  <p className={cn('text-[10px] font-bold flex items-center gap-1', (firstHive?.humidity ?? 55) >= 50 && (firstHive?.humidity ?? 55) <= 70 ? 'text-[#1b6d24]' : 'text-[#735c00]')}>
                    <span className="material-symbols-outlined text-[12px]">{(firstHive?.humidity ?? 55) >= 50 && (firstHive?.humidity ?? 55) <= 70 ? 'check_circle' : 'info'}</span>
                    {(firstHive?.humidity ?? 55) >= 50 && (firstHive?.humidity ?? 55) <= 70 ? 'Stable' : 'Unusual'}
                  </p>
                </div>
                <div className="bg-[#f1f4fa] p-4 rounded-xl border border-transparent hover:border-[#d7c3ae]/30 transition-all">
                  <p className="text-[10px] font-bold text-[#524434] uppercase mb-2">Activity</p>
                  <p className="text-xl font-black text-[#181c20]">{firstHive?.activity_change > 10 ? 'High' : firstHive?.activity_change > 0 ? 'Moderate' : 'Low'}</p>
                  <p className={cn('text-[10px] font-bold flex items-center gap-1', (firstHive?.activity_change ?? 0) > 0 ? 'text-[#735c00]' : 'text-[#524434]')}>
                    <span className="material-symbols-outlined text-[12px]">bolt</span>
                    {(firstHive?.activity_change ?? 0) > 10 ? 'Intense Flow' : (firstHive?.activity_change ?? 0) > 0 ? 'Active' : 'Calm'}
                  </p>
                </div>
                <div className="bg-[#f1f4fa] p-4 rounded-xl border border-transparent hover:border-[#d7c3ae]/30 transition-all">
                  <p className="text-[10px] font-bold text-[#524434] uppercase mb-2">Sound</p>
                  <p className="text-xl font-black text-[#181c20]">{firstHive?.sound_status || 'Steady'}</p>
                  <p className={cn('text-[10px] font-bold flex items-center gap-1', firstHive?.sound_status === 'Steady' ? 'text-[#1b6d24]' : 'text-[#ba1a1a]')}>
                    <span className="material-symbols-outlined text-[12px]">volume_up</span>
                    {firstHive?.sound_status === 'Steady' ? 'Normal' : 'Attention'}
                  </p>
                </div>
              </div>
            </div>

            {/* Honey Production Chart */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#d7c3ae]/10">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="font-bold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>Honey Production Logs</h3>
                  <p className="text-xs text-[#524434]">Last 30 days yielding performance</p>
                </div>
                <select className="text-xs font-bold bg-[#f1f4fa] border-none rounded-lg focus:ring-0 px-3 py-1.5">
                  <option>Volume (kg)</option>
                  <option>Target %</option>
                </select>
              </div>
              <div className="h-64 w-full">
                <Charts.ResponsiveContainer width="100%" height="100%">
                  <Charts.AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="honeyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#835400" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#835400" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Charts.XAxis dataKey="day" tick={{ fontSize: 10, fill: '#524434', fontWeight: 700 }} tickLine={false} axisLine={false} />
                    <Charts.Tooltip
                      contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #d7c3ae', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}
                      formatter={(value: number) => [`${value} kg`, 'Volume']}
                    />
                    <Charts.Area type="monotone" dataKey="volume" stroke="#835400" strokeWidth={2} fill="url(#honeyGradient)" dot={{ r: 3, fill: '#ffffff', stroke: '#835400', strokeWidth: 1.5 }} activeDot={{ r: 5, fill: '#835400', stroke: '#ffffff', strokeWidth: 2 }} />
                  </Charts.AreaChart>
                </Charts.ResponsiveContainer>
              </div>
            </div>

            {/* Pest Monitoring Alerts Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#d7c3ae]/10 overflow-hidden">
              <div className="p-6 border-b border-[#e5e8ee] flex justify-between items-center">
                <h3 className="font-bold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>Pest Monitoring Alerts</h3>
                <button className="text-xs font-bold text-[#835400] hover:underline" onClick={() => navigate('/pest-control')}>View All Records</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#f1f4fa] text-[10px] font-bold text-[#524434] uppercase tracking-widest">
                    <tr>
                      <th className="px-6 py-4">Detection Date</th>
                      <th className="px-6 py-4">Hive ID</th>
                      <th className="px-6 py-4">Pest Type</th>
                      <th className="px-6 py-4">Action Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-[#e5e8ee]">
                    {pestAlerts.map((alert, idx) => (
                      <tr key={idx} className="hover:bg-[#f1f4fa]/50 transition-colors">
                        <td className="px-6 py-4 font-medium">{alert.date}</td>
                        <td className="px-6 py-4">{alert.hive}</td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-2">
                            <span className={cn('w-2 h-2 rounded-full', alert.dotColor)} />
                            {alert.pest}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn('px-2 py-1 rounded-full text-[10px] font-bold', alert.statusBg, alert.statusText)}>
                            {alert.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Column: Colony Deep Dive */}
          <div className="space-y-6">
            <h3 className="font-bold text-[#181c20] text-lg mb-6 flex items-center gap-2" style={{ fontFamily: 'Manrope' }}>
              <span className="w-1 h-6 bg-[#1b6d24] rounded-full" />
              Colony Deep Dive
            </h3>

            {/* Hive Alpha Colony Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#d7c3ae]/10 p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-[#e5e8ee] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#ffddb5] rounded-xl flex items-center justify-center font-black text-[#835400]">A</div>
                  <div>
                    <p className="font-bold text-[#181c20] leading-none">{firstHive?.name || 'Hive'}</p>
                    <p className="text-[10px] text-[#1b6d24] font-bold uppercase tracking-tighter">{firstHive?.status === 'Thriving' ? 'Peak Performance' : 'Needs Attention'}</p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-slate-300">more_vert</span>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#f1f4fa]">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[#835400]">female</span>
                    <span className="text-xs font-medium text-[#524434]">Queen Presence</span>
                  </div>
                  <span className={cn('text-xs font-bold', firstHive?.queen_name ? 'text-[#181c20]' : 'text-[#ba1a1a]')}>{firstHive?.queen_name ? `${firstHive.queen_name} Active` : 'Unconfirmed'}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#f1f4fa]">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[#835400]">pattern</span>
                    <span className="text-xs font-medium text-[#524434]">Brood Pattern</span>
                  </div>
                  <span className="text-xs font-bold text-[#181c20]">{firstHive?.status === 'Thriving' ? 'Solid/Even' : firstHive?.status === 'Alert' ? 'Spotty' : 'Mixed'}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#f1f4fa]">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[#835400]">egg</span>
                    <span className="text-xs font-medium text-[#524434]">Laying Status</span>
                  </div>
                  <span className="text-xs font-bold text-[#181c20]">{firstHive?.status === 'Thriving' ? 'High Rate' : firstHive?.status === 'Alert' ? 'Low Rate' : 'Moderate'}</span>
                </div>
              </div>
              <div className="pt-2">
                <div className="flex justify-between text-[10px] font-bold text-[#524434] mb-2">
                  <span>POPULATION DENSITY</span>
                  <span>{firstHive?.population_density ?? 0}%</span>
                </div>
                <div className="h-1.5 w-full bg-[#dfe3e8] rounded-full">
                  <div className="h-full bg-[#1b6d24] rounded-full" style={{ width: `${firstHive?.population_density ?? 0}%` }} />
                </div>
              </div>
            </div>

            {/* Hive Beta Colony Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#d7c3ae]/10 p-6 space-y-6 opacity-80">
              <div className="flex items-center justify-between border-b border-[#e5e8ee] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#ffe087] rounded-xl flex items-center justify-center font-black text-[#735c00]">B</div>
                  <div>
                    <p className="font-bold text-[#181c20] leading-none">{secondHive?.name || 'Hive'}</p>
                    <p className="text-[10px] text-[#ba1a1a] font-bold uppercase tracking-tighter">{secondHive?.status === 'Thriving' ? 'Peak Performance' : secondHive?.status === 'Alert' ? 'Intervention Needed' : 'Needs Attention'}</p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-slate-300">more_vert</span>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className={cn('flex items-center justify-between p-3 rounded-xl', secondHive?.queen_name ? 'bg-[#f1f4fa]' : 'bg-[#ffdad6]/10')}>
                  <div className="flex items-center gap-3">
                    <span className={cn('material-symbols-outlined', secondHive?.queen_name ? 'text-[#835400]' : 'text-[#ba1a1a]')}>{secondHive?.queen_name ? 'female' : 'warning'}</span>
                    <span className="text-xs font-medium text-[#524434]">Queen Presence</span>
                  </div>
                  <span className={cn('text-xs font-bold', secondHive?.queen_name ? 'text-[#181c20]' : 'text-[#ba1a1a]')}>{secondHive?.queen_name ? `${secondHive.queen_name} Active` : 'Unconfirmed'}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#f1f4fa]">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[#835400]">pattern</span>
                    <span className="text-xs font-medium text-[#524434]">Brood Pattern</span>
                  </div>
                  <span className="text-xs font-bold text-[#181c20]">{secondHive?.status === 'Thriving' ? 'Solid/Even' : secondHive?.status === 'Alert' ? 'Spotty' : 'Mixed'}</span>
                </div>
              </div>
              <button className="w-full py-3 rounded-xl border-2 border-dashed border-[#d7c3ae] text-[10px] font-bold text-[#524434] hover:bg-[#f1f4fa] transition-all uppercase tracking-widest" onClick={() => navigate('/hives')}>
                Schedule Deep Inspection
              </button>
            </div>

            {/* Environment Outlook */}
            <div className="bg-gradient-to-br from-[#1b6d24] to-[#002204] text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <span className="material-symbols-outlined text-6xl">sunny</span>
              </div>
              <h4 className="font-bold text-sm mb-4" style={{ fontFamily: 'Manrope' }}>Environment Outlook</h4>
              <div className="flex items-center gap-4 mb-4">
                <span className="text-3xl font-black">24°C</span>
                <div className="h-8 w-[1px] bg-white/20" />
                <span className="text-xs leading-tight">
                  Clear Skies<br />Optimal Foraging
                </span>
              </div>
              <p className="text-[10px] opacity-80 leading-relaxed font-medium">
                Nectar flow is expected to peak between 10 AM and 2 PM today. Recommendation: Keep Hive Alpha entrance fully open.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#f7f9ff]/90 backdrop-blur-md border-t border-[#d7c3ae]/20 flex justify-around py-4 z-50">
        <button className="flex flex-col items-center gap-1 text-[#835400]" onClick={() => navigate('/')}>
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>dashboard</span>
          <span className="text-[10px] font-bold">Home</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/hives')}>
          <span className="material-symbols-outlined">grid_view</span>
          <span className="text-[10px] font-bold">Hives</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/honey-production')}>
          <span className="material-symbols-outlined">water_drop</span>
          <span className="text-[10px] font-bold">Yield</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/settings')}>
          <span className="material-symbols-outlined">settings</span>
          <span className="text-[10px] font-bold">Profile</span>
        </button>
      </nav>
    </div>
  );
}
