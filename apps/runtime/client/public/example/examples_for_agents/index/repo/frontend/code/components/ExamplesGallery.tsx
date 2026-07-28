import { React } from '@exepad/sdk';
const { useState, useEffect, useMemo } = React;

interface ExampleItem {
  label: string;
  name: string;
  href: string;
}

interface Section {
  title: string;
  description: string;
  count: number;
  items: ExampleItem[];
}

interface IndexData {
  title: string;
  total: number;
  sections: Section[];
}

const SECTION_COLORS: Record<string, { bg: string; border: string; badge: string; icon: string }> = {
  'Full Apps': { bg: 'bg-rose-50', border: 'border-rose-200', badge: 'bg-rose-100 text-rose-800', icon: 'M3.75 3A1.75 1.75 0 002 4.75v14.5c0 .966.784 1.75 1.75 1.75h16.5A1.75 1.75 0 0022 19.25V4.75A1.75 1.75 0 0020.25 3H3.75zM6 8h12M6 12h12M6 16h8' },
  'Backend Examples': { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-800', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4' },
  'HTML Imported Apps': { bg: 'bg-violet-50', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-800', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
  'Component Blocks': { bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-800', icon: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z' },
};

export default function ExamplesGallery() {
  const [data, setData] = useState<IndexData | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/example/examples_for_agents/index/index.json')
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!search.trim()) return data.sections;
    const q = search.toLowerCase();
    return data.sections
      .map(s => ({ ...s, items: s.items.filter(i => i.label.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)) }))
      .filter(s => s.items.length > 0);
  }, [data, search]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <p className="text-red-500">Failed to load examples: {error}</p>
      </div>
    );
  }

  if (!data || !filtered) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="animate-pulse space-y-4 w-full max-w-2xl px-8">
          <div className="h-10 bg-slate-200 rounded w-1/2" />
          <div className="h-5 bg-slate-100 rounded w-3/4" />
          <div className="grid grid-cols-3 gap-4 mt-8">
            {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  const totalFiltered = filtered.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Hero */}
      <div className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Exepad Examples</h1>
          <p className="mt-2 text-slate-500 text-lg">
            {data.total} example apps and components to explore
          </p>

          {/* Search */}
          <div className="mt-6 relative max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search examples..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-400"
            />
            {search && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                {totalFiltered} result{totalFiltered !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-12">
        {filtered.map(section => {
          const colors = SECTION_COLORS[section.title] || SECTION_COLORS['Component Blocks'];
          return (
            <div key={section.title}>
              {/* Section Header */}
              <div className="flex items-center gap-3 mb-2">
                <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={colors.icon} />
                </svg>
                <h2 className="text-xl font-semibold text-slate-900">{section.title}</h2>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors.badge}`}>
                  {section.items.length}
                </span>
              </div>
              <p className="text-sm text-slate-500 mb-5 ml-8">{section.description}</p>

              {/* Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 ml-8">
                {section.items.map(item => (
                  <a
                    key={item.name}
                    href={item.href}
                    className={`group block px-4 py-3 rounded-lg border ${colors.border} ${colors.bg} hover:shadow-md hover:scale-[1.02] transition-all duration-150`}
                  >
                    <span className="text-sm font-medium text-slate-800 group-hover:text-blue-600 transition-colors">
                      {item.label}
                    </span>
                    <span className="block text-xs text-slate-400 mt-0.5 truncate font-mono">
                      {item.name}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-slate-400 text-lg">No examples match "{search}"</p>
            <button onClick={() => setSearch('')} className="mt-3 text-sm text-blue-600 hover:underline">Clear search</button>
          </div>
        )}
      </div>
    </div>
  );
}
