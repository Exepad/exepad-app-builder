import { React, Charts, cn, navigate, useModel, useHandler, useCurrentUser, toast } from '@exepad/sdk';
const { useState, useEffect, useMemo } = React;

const statusConfig = {
  Thriving: { icon: 'nest_eco_leaf', iconBg: 'bg-[#ffddb5]/30', iconColor: 'text-[#835400]', badgeBg: 'bg-[#a0f399]/30', badgeText: 'text-[#1b6d24]', barColor: '#1b6d24', shadowColor: 'hover:shadow-[#835400]/5', dotClass: 'bg-[#1b6d24] animate-pulse' },
  Alert: { icon: 'warning', iconBg: 'bg-[#ffdad6]/30', iconColor: 'text-[#ba1a1a]', badgeBg: 'bg-[#ffdad6]', badgeText: 'text-[#93000a]', barColor: '#ba1a1a', shadowColor: 'hover:shadow-[#ba1a1a]/5', dotClass: '' },
  Monitoring: { icon: 'visibility', iconBg: 'bg-[#ffe087]/30', iconColor: 'text-[#735c00]', badgeBg: 'bg-[#dcb530]/40', badgeText: 'text-[#5a4700]', barColor: '#735c00', shadowColor: 'hover:shadow-[#735c00]/5', dotClass: '' },
};

function HiveActivityChart({ hiveId, barColor }: { hiveId: string; barColor: string }) {
  const activity = useHandler('getHiveActivityData', { params: { hive_id: hiveId, hours: 24 }, autoFetch: true });
  const chartData = (activity.data?.data || []).map((d: any) => ({ hour: d.hour, value: d.activity }));
  if (chartData.length === 0) return <div className="h-12 w-full bg-[#f1f4fa] rounded animate-pulse" />;
  return (
    <div className="h-12 w-full">
      <Charts.ResponsiveContainer width="100%" height="100%">
        <Charts.BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Charts.Bar dataKey="value" fill={barColor} opacity={0.3} radius={[2, 2, 0, 0]} />
        </Charts.BarChart>
      </Charts.ResponsiveContainer>
    </div>
  );
}

export default function HivesContent({ className }) {
  const user = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showAddHive, setShowAddHive] = useState(false);
  const [newHive, setNewHive] = useState({ name: '', location: '', queen_name: '', queen_marking_color: '', status: 'Thriving' });
  const { data: hives, loading, create } = useModel('hives', { orderBy: { name: 'asc' }, ...(statusFilter ? { filters: { status: statusFilter } } : {}) });
  const allHives = hives || [];

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
                placeholder="Search hives or logs..."
                type="text"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95">
              <span className="material-symbols-outlined">history</span>
            </button>
            <button className="p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95">
              <span className="material-symbols-outlined">notifications</span>
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

      {/* Page Content */}
      <div className="p-6 lg:p-10 space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-end gap-6">
          <div>
            <span className="text-xs tracking-widest text-[#524434] uppercase">Active Apiary</span>
            <h2 className="font-extrabold text-4xl text-[#181c20] tracking-tight mt-1" style={{ fontFamily: 'Manrope' }}>
              Hive Inventory
            </h2>
            <p className="text-[#524434] mt-2 max-w-lg">Monitoring {allHives.length} active colonies across the Golden Valley sector. All sensors reporting nominal status.</p>
          </div>
          <div className="flex gap-3">
            <div className="relative">
              <button onClick={() => setShowFilterDropdown(!showFilterDropdown)} className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-[#181c20] font-semibold shadow-sm hover:shadow-md transition-all active:scale-95 border border-[#d7c3ae]/10">
                <span className="material-symbols-outlined">filter_list</span>
                Filter
              </button>
              {showFilterDropdown && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-xl border border-[#d7c3ae]/20 py-2 z-50 min-w-[160px]">
                  {['', 'Thriving', 'Monitoring', 'Alert'].map(s => (
                    <button key={s} onClick={() => { setStatusFilter(s); setShowFilterDropdown(false); }} className={cn('w-full text-left px-4 py-2 text-sm hover:bg-[#f1f4fa] transition-colors', statusFilter === s && 'font-bold text-[#835400]')}>
                      {s || 'All Status'}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowAddHive(true)} className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#835400] to-[#f9a825] text-white font-bold shadow-lg shadow-[#835400]/20 active:scale-95 transition-all">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>add_circle</span>
              Add New Hive
            </button>
          </div>
        </div>

        {/* Bento Grid of Hive Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
          {loading && <div className="col-span-full text-center py-12 text-[#524434]">Loading hives...</div>}
          {allHives.map((hive: any) => {
            const config = statusConfig[hive.status] || statusConfig.Thriving;
            const changeColor = (hive.activity_change || 0) >= 0 ? 'text-[#1b6d24]' : 'text-[#ba1a1a]';
            const changePrefix = (hive.activity_change || 0) >= 0 ? '+' : '';
            const tempColor = hive.status === 'Alert' ? 'text-[#ba1a1a]' : 'text-[#181c20]';
            return (
              <div key={hive.id} className={cn('group bg-white rounded-2xl p-6 shadow-sm border border-transparent hover:shadow-xl transition-all duration-300 flex flex-col gap-6', config.shadowColor)}>
                <div className="flex justify-between items-start">
                  <div className={cn('p-3 rounded-xl', config.iconBg, config.iconColor)}>
                    <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>{config.icon}</span>
                  </div>
                  <span className={cn('px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1', config.badgeBg, config.badgeText)}>
                    {config.dotClass && <span className={cn('w-1.5 h-1.5 rounded-full', config.dotClass)} />}
                    {hive.status}
                  </span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>{hive.name}</h3>
                  {hive.queen_name && <p className="text-sm text-[#524434]">Queen: {hive.queen_name}{hive.queen_marking_color ? ` (Marked ${hive.queen_marking_color})` : ''}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#f1f4fa] p-4 rounded-xl">
                    <span className="text-[10px] text-[#524434] uppercase tracking-tighter">Temperature</span>
                    <p className={cn('text-lg font-bold', tempColor)} style={{ fontFamily: 'Manrope' }}>{hive.temperature ?? '—'}°C</p>
                  </div>
                  <div className="bg-[#f1f4fa] p-4 rounded-xl">
                    <span className="text-[10px] text-[#524434] uppercase tracking-tighter">Humidity</span>
                    <p className="text-lg font-bold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>{hive.humidity ?? '—'}%</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs text-[#524434]">
                    <span>Activity (24h)</span>
                    <span className={cn('font-semibold', changeColor)}>{changePrefix}{hive.activity_change ?? 0}%</span>
                  </div>
                  <HiveActivityChart hiveId={hive.id} barColor={config.barColor} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Action Button for Mobile */}
      <button onClick={() => setShowAddHive(true)} className="fixed bottom-20 right-6 lg:hidden w-14 h-14 rounded-full bg-[#835400] text-white shadow-xl flex items-center justify-center active:scale-90 transition-transform z-50">
        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'wght' 600" }}>add</span>
      </button>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#f7f9ff]/90 backdrop-blur-md border-t border-[#d7c3ae]/20 flex justify-around py-4 z-50">
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/')}>
          <span className="material-symbols-outlined">dashboard</span>
          <span className="text-[10px] font-bold">Overview</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#835400]" onClick={() => navigate('/hives')}>
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>grid_view</span>
          <span className="text-[10px] font-bold">Hives</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/honey-production')}>
          <span className="material-symbols-outlined">water_drop</span>
          <span className="text-[10px] font-bold">Production</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#524434]" onClick={() => navigate('/settings')}>
          <span className="material-symbols-outlined">settings</span>
          <span className="text-[10px] font-bold">Settings</span>
        </button>
      </nav>

      {showAddHive && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowAddHive(false)}>
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-xl mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-xl text-[#181c20] mb-6" style={{ fontFamily: 'Manrope' }}>Add New Hive</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Hive Name *</label>
                <input className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400]" placeholder="e.g. Hive Omega" value={newHive.name} onChange={e => setNewHive({...newHive, name: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Location</label>
                <input className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400]" placeholder="e.g. North Field" value={newHive.location} onChange={e => setNewHive({...newHive, location: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Queen Name</label>
                  <input className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400]" placeholder="e.g. Athena" value={newHive.queen_name} onChange={e => setNewHive({...newHive, queen_name: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Marking Color</label>
                  <select className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400]" value={newHive.queen_marking_color} onChange={e => setNewHive({...newHive, queen_marking_color: e.target.value})}>
                    <option value="">None</option>
                    <option>Blue</option>
                    <option>White</option>
                    <option>Yellow</option>
                    <option>Red</option>
                    <option>Green</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Initial Status</label>
                <select className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400]" value={newHive.status} onChange={e => setNewHive({...newHive, status: e.target.value})}>
                  <option>Thriving</option>
                  <option>Monitoring</option>
                  <option>Alert</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowAddHive(false)} className="flex-1 py-3 rounded-xl border border-[#d7c3ae]/30 text-[#524434] font-semibold text-sm hover:bg-[#f1f4fa] transition-colors">Cancel</button>
              <button onClick={async () => {
                if (!newHive.name.trim()) return;
                await create(newHive);
                toast('Hive added successfully', 'success');
                setShowAddHive(false);
                setNewHive({ name: '', location: '', queen_name: '', queen_marking_color: '', status: 'Thriving' });
              }} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#835400] to-[#f9a825] text-white font-bold text-sm shadow-lg active:scale-95 transition-all">Add Hive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
