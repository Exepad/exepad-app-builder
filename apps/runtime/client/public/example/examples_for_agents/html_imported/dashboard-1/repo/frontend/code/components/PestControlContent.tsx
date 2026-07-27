import { React, Charts, cn, navigate, useModel, useHandler, useCurrentUser, toast } from '@exepad/sdk';
const { useState } = React;

const treatmentStatusStyles: Record<string, { statusBg: string; statusText: string }> = {
  'Success': { statusBg: 'bg-[#a0f399]/50', statusText: 'text-[#217128]' },
  'In Progress': { statusBg: 'bg-[#dcb530]/50', statusText: 'text-[#5a4700]' },
  'Failed': { statusBg: 'bg-[#ffdad6]/50', statusText: 'text-[#93000a]' },
};

const checklistItems = [
  { label: 'Equipment Sanitization', desc: 'Tools torched or soaked in 10% bleach solution between hive stands.', defaultChecked: false },
  { label: 'Entrance Hygiene', desc: 'Cleared dead bees and debris from landing boards to prevent disease spread.', defaultChecked: false },
  { label: 'Brood Pattern Check', desc: 'Inspected for sunken cappings or foul odor (AFB/EFB screen).', defaultChecked: true },
  { label: 'Robbing Prevention', desc: 'Confirmed entrance reducers are installed on weaker colonies.', defaultChecked: false },
  { label: 'Drone Monitoring', desc: 'Assessed drone brood for excessive mite concentration.', defaultChecked: true },
];

export default function PestControlContent({ className }) {
  const user = useCurrentUser();
  const [showLogTreatment, setShowLogTreatment] = useState(false);
  const [newTreatment, setNewTreatment] = useState({ hive_id: '', pest_type: '', treatment_name: '', notes: '' });

  const [miteMonths, setMiteMonths] = useState(6);
  const miteTrend = useHandler('getMiteLoadTrend', { params: { months: miteMonths }, autoFetch: true });
  const { data: treatments, create: treatmentCreate } = useModel('treatments', { orderBy: { applied_at: 'desc' }, limit: 10 });
  const { data: alerts } = useModel('pest_alerts', { filters: { status: 'active' }, orderBy: { severity: 'desc' }, limit: 5 });
  const { data: hivesForDropdown } = useModel('hives', { orderBy: { name: 'asc' } });

  const miteChartData = miteTrend.data?.data || [];
  const currentLoad = miteTrend.data?.currentLoad ?? 0;
  const momChange = miteTrend.data?.momChange ?? 0;
  const treatmentEfficacy = miteTrend.data?.treatmentEfficacy ?? 0;
  const activeAlertCount = (alerts || []).length;

  const treatmentRows = (treatments || []).map((t: any) => {
    const style = treatmentStatusStyles[t.status] || treatmentStatusStyles['In Progress'];
    return {
      date: new Date(t.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      hiveId: t.hive_id,
      pest: t.pest_type,
      treatment: t.treatment_name,
      status: t.status,
      ...style,
    };
  });

  const [checklist, setChecklist] = useState(checklistItems.map((item) => item.defaultChecked));

  const toggleCheck = (index: number) => {
    setChecklist((prev) => prev.map((val, i) => (i === index ? !val : val)));
  };

  return (
    <div className={cn('bg-[#f7f9ff] text-[#181c20] min-h-full', className)} style={{ fontFamily: 'Inter' }}>
      {/* TopAppBar */}
      <header className="w-full sticky top-0 z-40 bg-slate-50/70 backdrop-blur-md shadow-sm border-b border-slate-200/50">
        <div className="flex justify-between items-center px-6 py-3 w-full">
          <div className="flex items-center gap-4 flex-1">
            <span className="font-extrabold text-xl text-amber-700 tracking-tight" style={{ fontFamily: 'Manrope' }}>The Golden Hive</span>
            <div className="hidden md:flex relative w-full max-w-md">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">search</span>
              <input className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-[#835400]/20 transition-all" placeholder="Search apiary logs..." type="text" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button className="p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95">
              <span className="material-symbols-outlined">history</span>
            </button>
            <div className="w-9 h-9 rounded-full bg-[#ffddb5] flex items-center justify-center font-bold text-[#835400] text-sm border-2 border-[#ffddb5]">{(user?.name || user?.email || 'U')[0].toUpperCase()}</div>
          </div>
        </div>
      </header>

      {/* Dashboard Content */}
      <div className="p-6 lg:p-10 space-y-8">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="font-extrabold text-3xl md:text-4xl text-[#181c20] tracking-tight" style={{ fontFamily: 'Manrope' }}>Pest Control Monitoring</h2>
            <p className="text-[#524434] mt-2 max-w-2xl">Real-time health ledger for hive colony integrity. Monitor active infestations and maintain biosecurity protocols.</p>
          </div>
          <div className="flex gap-3">
            <button className="bg-white text-[#835400] border border-[#d7c3ae]/30 px-5 py-2.5 rounded-xl font-semibold shadow-sm hover:bg-[#f1f4fa] transition-colors flex items-center gap-2" onClick={() => {
              const csv = ['Date,Hive,Pest,Treatment,Status',
                ...treatmentRows.map((r: any) => `${r.date},${r.hiveId},${r.pest},${r.treatment},${r.status}`)
              ].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'treatments_report.csv';
              a.click();
              toast('Report exported', 'success');
            }}>
              <span className="material-symbols-outlined text-sm">download</span>
              Export Report
            </button>
            <button className="bg-[#835400] text-white px-5 py-2.5 rounded-xl font-semibold shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center gap-2" onClick={() => setShowLogTreatment(true)}>
              <span className="material-symbols-outlined text-sm">medical_services</span>
              Log Treatment
            </button>
          </div>
        </div>

        {/* Main Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-8 space-y-6">
            {/* Critical Interventions */}
            <section className="bg-[#ffdad6]/20 rounded-3xl p-6 border border-[#ba1a1a]/10 overflow-hidden relative">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <span className="material-symbols-outlined text-[#ba1a1a]" style={{ fontSize: '96px', fontVariationSettings: "'FILL' 1" }}>warning</span>
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-6">
                  <span className="material-symbols-outlined text-[#ba1a1a]" style={{ fontVariationSettings: "'FILL' 1" }}>emergency</span>
                  <h3 className="font-bold text-xl text-[#93000a]" style={{ fontFamily: 'Manrope' }}>Critical Interventions Required</h3>
                </div>
                <div className="space-y-4">
                  {(alerts || []).slice(0, 3).map((alert: any, idx: number) => {
                    const isCritical = alert.severity === 'critical' || alert.severity === 'high';
                    return (
                      <div key={alert.id} className={cn('bg-white p-5 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-start justify-between gap-4', isCritical ? 'border-l-4 border-[#ba1a1a]' : 'border-l-4 border-[#735c00]')}>
                        <div className="flex gap-4">
                          <div className={cn('p-3 rounded-xl h-fit', isCritical ? 'bg-[#ffdad6] text-[#ba1a1a]' : 'bg-[#dcb530]/30 text-[#735c00]')}>
                            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{isCritical ? 'bug_report' : 'local_florist'}</span>
                          </div>
                          <div>
                            <h4 className="font-bold text-lg text-[#181c20]">{alert.pest_type}</h4>
                            <p className="text-[#524434] text-sm mt-1">Hive {alert.hive_id} &bull; {alert.severity} severity</p>
                            <div className="flex gap-2 mt-3">
                              <span className={cn('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full', isCritical ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]' : 'bg-[#735c00]/10 text-[#735c00]')}>{isCritical ? 'Immediate Action' : 'Monitoring'}</span>
                            </div>
                          </div>
                        </div>
                        <button onClick={async () => { await treatmentCreate({ hive_id: alert.hive_id, pest_type: alert.pest_type, treatment_name: 'Treatment Applied', status: 'In Progress', applied_at: new Date().toISOString() }); toast('Treatment logged', 'success'); }} className={cn('px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap', isCritical ? 'bg-[#ba1a1a] text-white hover:opacity-90' : 'text-[#735c00] border border-[#735c00]/20')}>
                          {isCritical ? 'Apply Treatment' : 'Inspect'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Mite Load Trend Chart */}
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-[#d7c3ae]/10">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="font-bold text-[#181c20]" style={{ fontFamily: 'Manrope' }}>Mite Load Trend</h3>
                  <p className="text-xs text-[#524434]">Phoretic mite percentage across all hives</p>
                </div>
                <select className="text-xs font-bold bg-[#f1f4fa] border-none rounded-lg focus:ring-0 px-3 py-1.5" value={miteMonths} onChange={e => setMiteMonths(Number(e.target.value))}>
                  <option value={6}>Last 6 Months</option>
                  <option value={12}>Last Year</option>
                </select>
              </div>
              <div className="h-64 w-full">
                <Charts.ResponsiveContainer width="100%" height="100%">
                  <Charts.BarChart data={miteChartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="miteGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ba1a1a" stopOpacity={0.8} />
                        <stop offset="100%" stopColor="#ba1a1a" stopOpacity={0.3} />
                      </linearGradient>
                    </defs>
                    <Charts.XAxis dataKey="month" tick={{ fontSize: 10, fill: '#524434', fontWeight: 700 }} tickLine={false} axisLine={false} />
                    <Charts.YAxis tick={{ fontSize: 10, fill: '#524434', fontWeight: 700 }} tickLine={false} axisLine={false} unit="%" />
                    <Charts.Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #d7c3ae', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }} formatter={(value: number) => [`${value}%`, 'Mite Load']} />
                    <Charts.Bar dataKey="load" fill="url(#miteGradient)" radius={[6, 6, 0, 0]} />
                  </Charts.BarChart>
                </Charts.ResponsiveContainer>
              </div>
            </section>

            {/* Recent Treatment History */}
            <section className="bg-[#f1f4fa] rounded-3xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-xl text-[#181c20]" style={{ fontFamily: 'Manrope' }}>Recent Treatment History</h3>
                <button className="text-[#835400] text-sm font-semibold flex items-center gap-1 hover:gap-2 transition-all">
                  View All <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[#524434] text-[10px] font-bold uppercase tracking-widest border-b border-[#d7c3ae]/10">
                      <th className="pb-4 px-2">Date</th>
                      <th className="pb-4 px-2">Hive ID</th>
                      <th className="pb-4 px-2">Pest Type</th>
                      <th className="pb-4 px-2">Treatment</th>
                      <th className="pb-4 px-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#d7c3ae]/10">
                    {treatmentRows.map((row, idx) => (
                      <tr key={idx} className="group hover:bg-[#dfe3e8]/30 transition-colors">
                        <td className="py-4 px-2 font-medium text-sm">{row.date}</td>
                        <td className="py-4 px-2 font-bold text-[#835400]">{row.hiveId}</td>
                        <td className="py-4 px-2 text-sm">{row.pest}</td>
                        <td className="py-4 px-2 text-sm italic">{row.treatment}</td>
                        <td className="py-4 px-2 text-right">
                          <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', row.statusBg, row.statusText)}>{row.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-[#d7c3ae]/20 h-full">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-10 h-10 bg-[#a3f69c] text-[#002204] rounded-xl flex items-center justify-center">
                  <span className="material-symbols-outlined">checklist</span>
                </div>
                <h3 className="font-bold text-xl text-[#181c20]" style={{ fontFamily: 'Manrope' }}>Biosecurity Checklist</h3>
              </div>
              <p className="text-xs text-[#524434] font-medium uppercase tracking-widest mb-4">Inspection Protocol v4.2</p>
              <div className="space-y-3">
                {checklistItems.map((item, idx) => (
                  <label key={idx} className="flex items-start gap-3 p-4 rounded-2xl hover:bg-[#f1f4fa] transition-colors cursor-pointer group border border-transparent hover:border-[#d7c3ae]/10">
                    <input type="checkbox" checked={checklist[idx]} onChange={() => toggleCheck(idx)} className="mt-1 w-5 h-5 rounded text-[#1b6d24] focus:ring-[#1b6d24] border-[#d7c3ae]" />
                    <div>
                      <span className="block font-bold text-[#181c20] group-hover:text-[#1b6d24] transition-colors">{item.label}</span>
                      <p className="text-xs text-[#524434] mt-1">{item.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div className="mt-8 p-4 bg-[#ffddb5]/20 rounded-2xl border border-[#ffb957]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-[#835400] text-sm">info</span>
                  <span className="text-xs font-bold text-[#2a1800] uppercase tracking-tight">Apiary Note</span>
                </div>
                <p className="text-xs text-[#643f00] leading-relaxed italic">&quot;The hive is a mirror. If the beekeeper is chaotic, the bees will reflect it. Stay vigilant, stay clean.&quot;</p>
              </div>
            </section>
          </div>
        </div>

        {/* Footer Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#dfe3e8]/50 p-6 rounded-3xl backdrop-blur-sm border border-[#d7c3ae]/10">
            <p className="text-[10px] font-bold text-[#524434] uppercase tracking-widest mb-1">Total Mite Load</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-[#181c20]" style={{ fontFamily: 'Manrope' }}>{currentLoad}%</span>
              <span className={cn('text-xs font-bold', momChange <= 0 ? 'text-[#1b6d24]' : 'text-[#ba1a1a]')}>({momChange > 0 ? '+' : ''}{momChange}% MoM)</span>
            </div>
          </div>
          <div className="bg-[#dfe3e8]/50 p-6 rounded-3xl backdrop-blur-sm border border-[#d7c3ae]/10">
            <p className="text-[10px] font-bold text-[#524434] uppercase tracking-widest mb-1">Treatment Efficacy</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-[#181c20]" style={{ fontFamily: 'Manrope' }}>{treatmentEfficacy}%</span>
              <span className="text-[#1b6d24] text-xs font-bold">(High Quality)</span>
            </div>
          </div>
          <div className="bg-[#dfe3e8]/50 p-6 rounded-3xl backdrop-blur-sm border border-[#d7c3ae]/10">
            <p className="text-[10px] font-bold text-[#524434] uppercase tracking-widest mb-1">Intervention Index</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-[#181c20]" style={{ fontFamily: 'Manrope' }}>{activeAlertCount}</span>
              <span className="text-[#ba1a1a] text-xs font-bold">(Action Needed)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#f7f9ff]/90 backdrop-blur-md border-t border-[#d7c3ae]/20 flex justify-around py-4 z-50">
        <button className="flex flex-col items-center gap-1 text-slate-500" onClick={() => navigate('/')}>
          <span className="material-symbols-outlined">dashboard</span>
          <span className="text-[10px] font-bold">Overview</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-slate-500" onClick={() => navigate('/hives')}>
          <span className="material-symbols-outlined">grid_view</span>
          <span className="text-[10px] font-bold">Hives</span>
        </button>
        <div className="-mt-8">
          <button className="bg-[#835400] text-white p-4 rounded-full shadow-lg active:scale-95">
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>
        <button className="flex flex-col items-center gap-1 text-amber-700" onClick={() => navigate('/pest-control')}>
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>bug_report</span>
          <span className="text-[10px] font-bold">Pests</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-slate-500" onClick={() => navigate('/settings')}>
          <span className="material-symbols-outlined">settings</span>
          <span className="text-[10px] font-bold">Settings</span>
        </button>
      </nav>

      {showLogTreatment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowLogTreatment(false)}>
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-xl mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-xl text-[#181c20] mb-6" style={{ fontFamily: 'Manrope' }}>Log Treatment</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Hive *</label>
                <select className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400]" value={newTreatment.hive_id} onChange={e => setNewTreatment({...newTreatment, hive_id: e.target.value})}>
                  <option value="">Select hive...</option>
                  {(hivesForDropdown || []).map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Pest Type *</label>
                <select className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400]" value={newTreatment.pest_type} onChange={e => setNewTreatment({...newTreatment, pest_type: e.target.value})}>
                  <option value="">Select pest...</option>
                  <option>Varroa Mites</option>
                  <option>Wax Moth</option>
                  <option>Small Hive Beetle</option>
                  <option>Nosema</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Treatment *</label>
                <input className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400]" placeholder="e.g. Oxalic Acid Dribble" value={newTreatment.treatment_name} onChange={e => setNewTreatment({...newTreatment, treatment_name: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Notes</label>
                <textarea className="w-full bg-[#f1f4fa] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] h-20 resize-none" placeholder="Additional notes..." value={newTreatment.notes} onChange={e => setNewTreatment({...newTreatment, notes: e.target.value})} />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowLogTreatment(false)} className="flex-1 py-3 rounded-xl border border-[#d7c3ae]/30 text-[#524434] font-semibold text-sm hover:bg-[#f1f4fa] transition-colors">Cancel</button>
              <button onClick={async () => {
                if (!newTreatment.hive_id || !newTreatment.pest_type || !newTreatment.treatment_name) return;
                await treatmentCreate({ ...newTreatment, status: 'In Progress', applied_at: new Date().toISOString() });
                toast('Treatment logged successfully', 'success');
                setShowLogTreatment(false);
                setNewTreatment({ hive_id: '', pest_type: '', treatment_name: '', notes: '' });
              }} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#835400] to-[#f9a825] text-white font-bold text-sm shadow-lg active:scale-95 transition-all">Log Treatment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
