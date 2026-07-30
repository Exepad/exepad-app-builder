import { React, cn, navigate, useModel, useCurrentUser, toast } from '@exepad/sdk';
const { useState, useEffect } = React;

export default function SettingsContent({ className }) {
  const user = useCurrentUser();
  const { data: settingsData, loading, update, create } = useModel('apiary_settings', { limit: 1 });
  const settings = settingsData?.[0];

  const [fullName, setFullName] = useState('');
  const [certId, setCertId] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [activeHives, setActiveHives] = useState('');
  const [floraType, setFloraType] = useState('Mixed Wildflower');
  const [weightLossEnabled, setWeightLossEnabled] = useState(true);
  const [tempThreshold, setTempThreshold] = useState(35);

  useEffect(() => {
    if (settings) {
      setFullName(settings.full_name || '');
      setCertId(settings.cert_id || '');
      setEmail(settings.email || '');
      setLocation(settings.location || '');
      setActiveHives(String(settings.active_hives_count || ''));
      setFloraType(settings.flora_type || 'Mixed Wildflower');
      setWeightLossEnabled(!!settings.weight_loss_alert_enabled);
      setTempThreshold(settings.temp_alert_threshold || 35);
    }
  }, [settings]);

  const handleSave = async () => {
    const data = {
      full_name: fullName,
      cert_id: certId,
      email,
      location,
      active_hives_count: parseInt(activeHives, 10) || 0,
      flora_type: floraType,
      weight_loss_alert_enabled: weightLossEnabled ? 1 : 0,
      temp_alert_threshold: tempThreshold,
    };
    if (settings?.id) {
      await update(settings.id, data);
    } else {
      await create(data);
    }
    toast('Settings saved successfully', 'success');
  };

  const handleDiscard = () => {
    if (settings) {
      setFullName(settings.full_name || '');
      setCertId(settings.cert_id || '');
      setEmail(settings.email || '');
      setLocation(settings.location || '');
      setActiveHives(String(settings.active_hives_count || ''));
      setFloraType(settings.flora_type || 'Mixed Wildflower');
      setWeightLossEnabled(!!settings.weight_loss_alert_enabled);
      setTempThreshold(settings.temp_alert_threshold || 35);
    }
  };

  return (
    <div className={cn('bg-[#f7f9ff] text-[#181c20] min-h-full', className)} style={{ fontFamily: 'Inter' }}>
      {/* TopAppBar */}
      <header className="w-full sticky top-0 z-40 bg-slate-50/70 backdrop-blur-md shadow-sm border-b border-slate-200/50">
        <div className="flex justify-between items-center px-6 py-3 w-full">
          <div className="flex items-center gap-4">
            <span className="lg:hidden material-symbols-outlined text-[#524434]">menu</span>
            <h2 className="font-bold text-lg text-amber-700" style={{ fontFamily: 'Manrope' }}>Settings</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#524434] text-sm">search</span>
              <input className="pl-10 pr-4 py-2 bg-[#dfe3e8] border-none rounded-full text-sm focus:ring-2 focus:ring-[#835400]/20 w-64 transition-all" placeholder="Search settings..." type="text" />
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-full hover:bg-slate-200/50 transition-colors active:scale-95">
                <span className="material-symbols-outlined text-[#524434]">notifications</span>
              </button>
              <button className="p-2 rounded-full hover:bg-slate-200/50 transition-colors active:scale-95">
                <span className="material-symbols-outlined text-[#524434]">history</span>
              </button>
              <div className="w-8 h-8 rounded-full bg-[#ffddb5] flex items-center justify-center font-bold text-[#835400] text-sm ml-2">{(user?.name || user?.email || 'U')[0].toUpperCase()}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Settings Content */}
      <div className="flex-1 p-6 lg:p-10 space-y-10">
        {/* Hero Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <span className="text-xs font-bold tracking-widest text-[#835400] uppercase">Configuration Shell</span>
            <h3 className="font-extrabold text-4xl text-[#181c20] tracking-tight" style={{ fontFamily: 'Manrope' }}>The Living Ledger Control</h3>
            <p className="text-[#524434] max-w-xl">Manage your apiary identity, sensor synchronization, and hive health thresholds from this centralized ledger.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleDiscard} className="px-6 py-2.5 rounded-lg border border-[#d7c3ae]/30 text-[#524434] font-semibold text-sm hover:bg-[#f1f4fa] transition-colors">Discard Changes</button>
            <button onClick={handleSave} className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-[#835400] to-[#f9a825] text-white font-bold text-sm shadow-lg shadow-[#835400]/10 active:scale-95 transition-all">Save Ledger</button>
          </div>
        </div>

        {/* Settings Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          {/* Left Column */}
          <div className="xl:col-span-8 space-y-8">
            <section className="bg-white rounded-xl p-8 shadow-sm ring-1 ring-slate-100/50">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-lg bg-[#ffddb5] flex items-center justify-center text-[#835400]">
                  <span className="material-symbols-outlined">person</span>
                </div>
                <div>
                  <h4 className="font-bold text-xl" style={{ fontFamily: 'Manrope' }}>Master Apiarist Profile</h4>
                  <p className="text-sm text-[#524434]">Update your professional credentials and public display</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Full Name</label>
                  <input className="w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Certification ID</label>
                  <input className="w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all" type="text" value={certId} onChange={(e) => setCertId(e.target.value)} />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Email Address</label>
                  <input className="w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
            </section>
            <section className="bg-white rounded-xl p-8 shadow-sm ring-1 ring-slate-100/50">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-lg bg-[#a0f399] flex items-center justify-center text-[#217128]">
                  <span className="material-symbols-outlined">potted_plant</span>
                </div>
                <div>
                  <h4 className="font-bold text-xl" style={{ fontFamily: 'Manrope' }}>Apiary Configuration</h4>
                  <p className="text-sm text-[#524434]">Define regional parameters and hive scale</p>
                </div>
              </div>
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Primary Location</label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#524434] text-sm">location_on</span>
                      <input className="w-full bg-[#dfe3e8] border-none rounded-lg pl-10 pr-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all" type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Active Hives</label>
                    <input className="w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all" type="number" value={activeHives} onChange={(e) => setActiveHives(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#524434] uppercase tracking-wider">Flora Type</label>
                    <select className="w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all" value={floraType} onChange={(e) => setFloraType(e.target.value)}>
                      <option>Mixed Wildflower</option>
                      <option>Lavender</option>
                      <option>Heather</option>
                      <option>Clover</option>
                    </select>
                  </div>
                </div>
                <div className="pt-6 border-t border-[#d7c3ae]/10">
                  <h5 className="font-bold text-sm mb-4" style={{ fontFamily: 'Manrope' }}>Health Notification Thresholds</h5>
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-sm">Critical Temperature Alert</p>
                        <p className="text-xs text-[#524434]">Trigger alert if hive temperature deviates by more than 5&deg;C</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-bold text-[#835400] bg-[#ffddb5]/30 px-2 py-1 rounded">{tempThreshold}&deg;C Target</span>
                        <input className="accent-[#835400] w-24" type="range" min={30} max={42} step={0.5} value={tempThreshold} onChange={(e) => setTempThreshold(parseFloat(e.target.value))} />
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-sm">Weight Loss Warning</p>
                        <p className="text-xs text-[#524434]">Detect sudden drops indicative of potential swarming</p>
                      </div>
                      <button type="button" className={cn('relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden', weightLossEnabled ? 'bg-[#1b6d24]' : 'bg-[#dfe3e8]')} onClick={() => setWeightLossEnabled(!weightLossEnabled)}>
                        <span className={cn('pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out', weightLossEnabled ? 'translate-x-5' : 'translate-x-0')} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column */}
          <div className="xl:col-span-4 space-y-8">
            <section className="bg-white rounded-xl p-8 shadow-sm ring-1 ring-slate-100/50">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-10 h-10 rounded-lg bg-[#ffe087] flex items-center justify-center text-[#241a00]">
                  <span className="material-symbols-outlined">sync</span>
                </div>
                <h4 className="font-bold text-lg" style={{ fontFamily: 'Manrope' }}>Sensor Network</h4>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-[#f1f4fa] rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-[#1b6d24]">check_circle</span>
                    <div>
                      <p className="text-sm font-bold">BeeLink Hub v2</p>
                      <p className="text-[10px] text-[#524434]">Last sync: 2 mins ago</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-[#1b6d24] uppercase tracking-tighter bg-[#a3f69c]/30 px-2 py-0.5 rounded">Active</span>
                </div>
                <button className="w-full py-3 text-sm font-bold text-[#835400] border border-[#835400]/20 rounded-lg flex items-center justify-center gap-2 hover:bg-[#ffddb5]/20 transition-colors">
                  <span className="material-symbols-outlined text-sm">add</span>
                  Add New Sensor
                </button>
                <div className="pt-4 mt-4 border-t border-[#d7c3ae]/10">
                  <button className="w-full py-3 text-sm font-semibold text-[#524434] hover:text-[#181c20] flex items-center gap-3">
                    <span className="material-symbols-outlined text-sm">download</span>
                    Export CSV Activity Logs
                  </button>
                  <button className="w-full py-3 text-sm font-semibold text-[#524434] hover:text-[#181c20] flex items-center gap-3">
                    <span className="material-symbols-outlined text-sm">api</span>
                    Manage API Keys
                  </button>
                </div>
              </div>
            </section>
            <section className="bg-white rounded-xl p-8 shadow-sm ring-1 ring-slate-100/50">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-10 h-10 rounded-lg bg-[#dfe3e8] flex items-center justify-center text-[#524434]">
                  <span className="material-symbols-outlined">contact_support</span>
                </div>
                <h4 className="font-bold text-lg" style={{ fontFamily: 'Manrope' }}>Hive Assistance</h4>
              </div>
              <div className="space-y-2">
                <a className="flex items-center justify-between p-3 rounded-lg hover:bg-[#f1f4fa] transition-colors group cursor-pointer">
                  <span className="text-sm font-medium">Documentation &amp; Guides</span>
                  <span className="material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all">arrow_forward</span>
                </a>
                <a className="flex items-center justify-between p-3 rounded-lg hover:bg-[#f1f4fa] transition-colors group cursor-pointer">
                  <span className="text-sm font-medium">Community Forum</span>
                  <span className="material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all">arrow_forward</span>
                </a>
                <a className="flex items-center justify-between p-3 rounded-lg hover:bg-[#f1f4fa] transition-colors group cursor-pointer">
                  <span className="text-sm font-medium">Technical Support</span>
                  <span className="material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all">arrow_forward</span>
                </a>
                <div className="mt-6 p-4 bg-[#ffddb5]/10 rounded-xl border-l-4 border-[#835400]">
                  <p className="text-xs font-bold text-[#643f00] mb-1">PRO TIP</p>
                  <p className="text-[11px] leading-relaxed text-[#643f00]">Regularly export your hive logs to maintain a physical backup of your production history.</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white flex justify-around items-center py-3 z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <button className="flex flex-col items-center gap-1 text-slate-500" onClick={() => navigate('/')}>
          <span className="material-symbols-outlined">dashboard</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Home</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-slate-500" onClick={() => navigate('/hives')}>
          <span className="material-symbols-outlined">grid_view</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Hives</span>
        </button>
        <div className="w-12 h-12 rounded-full bg-[#835400] flex items-center justify-center -mt-8 shadow-lg shadow-[#835400]/30 text-white">
          <span className="material-symbols-outlined">add</span>
        </div>
        <button className="flex flex-col items-center gap-1 text-slate-500" onClick={() => navigate('/honey-production')}>
          <span className="material-symbols-outlined">analytics</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Stats</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-amber-700" onClick={() => navigate('/settings')}>
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>settings</span>
          <span className="text-[10px] font-bold uppercase tracking-tighter">Config</span>
        </button>
      </nav>
    </div>
  );
}
