// repo/frontend/code/components/HoneyContent.tsx
import { React, Charts, cn } from "@exepad/sdk";
var harvestPerformanceData = [
  { month: "JAN", yield: 112 },
  { month: "FEB", yield: 88 },
  { month: "MAR", yield: 154 },
  { month: "APR", yield: 210 },
  { month: "MAY", yield: 245 },
  { month: "JUN", yield: 192 },
  { month: "JUL", yield: 98 },
  { month: "AUG", yield: 74 }
];
var harvestLedger = [
  {
    date: "Sep 24, 2024",
    hiveId: "ALPHA-01",
    quantity: "32.4",
    grade: "Grade A+",
    gradeColor: "bg-[#a0f399]/30 text-[#217128]",
    dotColor: "bg-[#1b6d24]",
    collector: "Marcus Thorne"
  },
  {
    date: "Sep 22, 2024",
    hiveId: "BETA-04",
    quantity: "28.1",
    grade: "Grade A",
    gradeColor: "bg-[#a0f399]/30 text-[#217128]",
    dotColor: "bg-[#1b6d24]",
    collector: "Elara Vance"
  },
  {
    date: "Sep 20, 2024",
    hiveId: "GAMMA-02",
    quantity: "19.5",
    grade: "Grade B",
    gradeColor: "bg-[#dcb530]/20 text-[#5a4700]",
    dotColor: "bg-[#735c00]",
    collector: "Marcus Thorne"
  },
  {
    date: "Sep 18, 2024",
    hiveId: "ALPHA-03",
    quantity: "35.0",
    grade: "Grade A+",
    gradeColor: "bg-[#a0f399]/30 text-[#217128]",
    dotColor: "bg-[#1b6d24]",
    collector: "Sarah Bloom"
  }
];
function HoneyContent({ className }) {
  return /* @__PURE__ */ React.createElement("div", { className: cn("flex-1 min-h-screen bg-[#f7f9ff]", className), style: { fontFamily: "Inter" } }, /* @__PURE__ */ React.createElement("header", { className: "w-full sticky top-0 z-40 bg-slate-50/70 backdrop-blur-md shadow-sm border-b border-slate-200/50" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center px-6 py-3 w-full" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4 flex-1" }, /* @__PURE__ */ React.createElement("div", { className: "relative w-full max-w-md" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" }, "search"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-[#835400]/20 transition-all",
      placeholder: "Search harvests...",
      type: "text"
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, /* @__PURE__ */ React.createElement("button", { className: "p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "notifications")), /* @__PURE__ */ React.createElement("button", { className: "p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "history")), /* @__PURE__ */ React.createElement("div", { className: "h-8 w-[1px] bg-slate-200 mx-2" }), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3 pl-2" }, /* @__PURE__ */ React.createElement("div", { className: "text-right hidden sm:block" }, /* @__PURE__ */ React.createElement("p", { className: "text-sm font-bold text-[#181c20] leading-none" }, "Silas Marner"), /* @__PURE__ */ React.createElement("p", { className: "text-[10px] text-[#524434] uppercase tracking-tighter" }, "Master Apiarist")), /* @__PURE__ */ React.createElement(
    "img",
    {
      alt: "User profile avatar",
      className: "w-9 h-9 rounded-full object-cover border-2 border-[#ffddb5]",
      src: "https://lh3.googleusercontent.com/aida-public/AB6AXuBONjqHj_rkXY2UxZ_PH6SBRRGoBvrqFJ6AJYdHfNiX38Vx1xSYBMFOBA05Wsx4zvcKLoCNqPQm0PEEJRLCsVgeNTpgm6wCEnTYijsN6gngwB0o2fZkj7dCp6mPJ8IbJJBGYwW8urGcWfJfAOleuRJW0BNHPiSOGRXAKXqvILn6wxKoEyXsSTGiH_dA8-AcvE-ltGjamnAzrLL5SDeac6wwicdvSzPbLqr0cZ0KzW7MgV_GVc6SZu-wy6VTdZrU8a_6_ebx2MWBbHGe"
    }
  ))))), /* @__PURE__ */ React.createElement("div", { className: "p-6 lg:p-10 space-y-10" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col md:flex-row md:items-end justify-between gap-6" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { className: "font-extrabold text-3xl text-[#181c20] tracking-tight mb-2", style: { fontFamily: "Manrope" } }, "Honey Production Logs"), /* @__PURE__ */ React.createElement("p", { className: "text-[#524434] max-w-2xl" }, "A comprehensive ledger of every harvest. Track yields, monitor quality trends, and forecast upcoming production cycles across all managed apiaries.")), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, /* @__PURE__ */ React.createElement("button", { className: "bg-white text-[#181c20] px-4 py-2.5 rounded-lg font-medium text-sm flex items-center gap-2 border border-[#d7c3ae]/20 shadow-sm hover:bg-[#f1f4fa] transition-colors" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "filter_list"), "Filter"), /* @__PURE__ */ React.createElement("button", { className: "bg-[#835400] text-white px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 shadow-md hover:opacity-95 transition-opacity" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "download"), "Export CSV"))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6" }, /* @__PURE__ */ React.createElement("div", { className: "bg-white p-6 rounded-xl relative overflow-hidden group" }, /* @__PURE__ */ React.createElement("div", { className: "absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-6xl" }, "equalizer")), /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-[#524434] tracking-[0.05em] mb-1" }, "TOTAL SEASON YIELD"), /* @__PURE__ */ React.createElement("div", { className: "flex items-baseline gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-4xl font-extrabold text-[#181c20]", style: { fontFamily: "Manrope" } }, "1,428.5"), /* @__PURE__ */ React.createElement("span", { className: "text-[#524434] font-medium text-lg" }, "kg")), /* @__PURE__ */ React.createElement("div", { className: "mt-4 flex items-center gap-2 text-[#1b6d24] font-semibold text-sm" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "trending_up"), /* @__PURE__ */ React.createElement("span", null, "12% increase from 2023"))), /* @__PURE__ */ React.createElement("div", { className: "bg-white p-6 rounded-xl relative overflow-hidden group" }, /* @__PURE__ */ React.createElement("div", { className: "absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-6xl" }, "analytics")), /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-[#524434] tracking-[0.05em] mb-1" }, "AVG YIELD PER HIVE"), /* @__PURE__ */ React.createElement("div", { className: "flex items-baseline gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-4xl font-extrabold text-[#181c20]", style: { fontFamily: "Manrope" } }, "24.2"), /* @__PURE__ */ React.createElement("span", { className: "text-[#524434] font-medium text-lg" }, "kg")), /* @__PURE__ */ React.createElement("div", { className: "mt-4 flex items-center gap-2 text-[#735c00] font-semibold text-sm" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "remove"), /* @__PURE__ */ React.createElement("span", null, "Stable across 48 hives"))), /* @__PURE__ */ React.createElement("div", { className: "bg-white p-6 rounded-xl border-l-4 border-[#f9a825] relative overflow-hidden group" }, /* @__PURE__ */ React.createElement("div", { className: "absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-6xl" }, "event")), /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-[#524434] tracking-[0.05em] mb-1" }, "EST. NEXT HARVEST"), /* @__PURE__ */ React.createElement("div", { className: "flex items-baseline gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-4xl font-extrabold text-[#181c20]", style: { fontFamily: "Manrope" } }, "Oct 14")), /* @__PURE__ */ React.createElement("div", { className: "mt-4 flex items-center gap-2 text-[#524434] font-semibold text-sm" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "timer"), /* @__PURE__ */ React.createElement("span", null, "Approximately 18 days left")))), /* @__PURE__ */ React.createElement("div", { className: "bg-[#f1f4fa] rounded-2xl p-8" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-8" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "text-xl font-bold text-[#181c20]", style: { fontFamily: "Manrope" } }, "Harvest Performance"), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-[#524434]" }, "Monthly honey production volumes (kg)")), /* @__PURE__ */ React.createElement("div", { className: "flex bg-white p-1 rounded-lg border border-[#d7c3ae]/20" }, /* @__PURE__ */ React.createElement("button", { className: "px-4 py-1.5 text-sm font-semibold bg-[#835400] text-white rounded-md shadow-sm" }, "Monthly"), /* @__PURE__ */ React.createElement("button", { className: "px-4 py-1.5 text-sm font-medium text-[#524434] hover:text-[#181c20] transition-colors" }, "Quarterly"))), /* @__PURE__ */ React.createElement("div", { className: "h-[320px] w-full" }, /* @__PURE__ */ React.createElement(Charts.ResponsiveContainer, { width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(Charts.BarChart, { data: harvestPerformanceData, margin: { top: 20, right: 10, left: -10, bottom: 5 } }, /* @__PURE__ */ React.createElement(
    Charts.XAxis,
    {
      dataKey: "month",
      tick: { fontSize: 10, fill: "#524434", fontWeight: 700 },
      tickLine: false,
      axisLine: false
    }
  ), /* @__PURE__ */ React.createElement(
    Charts.YAxis,
    {
      tick: { fontSize: 10, fill: "#524434" },
      tickLine: false,
      axisLine: false,
      tickFormatter: (value) => `${value}kg`
    }
  ), /* @__PURE__ */ React.createElement(
    Charts.Tooltip,
    {
      contentStyle: {
        backgroundColor: "#181c20",
        border: "none",
        borderRadius: "8px",
        fontSize: "12px",
        fontWeight: 600,
        color: "#f7f9ff"
      },
      formatter: (value) => [`${value} kg`, "Yield"],
      cursor: { fill: "rgba(131, 84, 0, 0.05)" }
    }
  ), /* @__PURE__ */ React.createElement(
    Charts.Bar,
    {
      dataKey: "yield",
      fill: "#835400",
      opacity: 0.25,
      radius: [6, 6, 0, 0]
    }
  ))))), /* @__PURE__ */ React.createElement("div", { className: "bg-white rounded-2xl overflow-hidden shadow-sm" }, /* @__PURE__ */ React.createElement("div", { className: "p-6 border-b border-[#ebeef4] flex flex-col sm:flex-row sm:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("h3", { className: "text-lg font-bold text-[#181c20]", style: { fontFamily: "Manrope" } }, "Detailed Harvest Ledger"), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "pl-9 pr-4 py-1.5 bg-[#e5e8ee]/50 border-none rounded-lg text-sm focus:ring-1 focus:ring-[#835400] w-full md:w-48 placeholder-[#524434]/70",
      placeholder: "Filter by collector...",
      type: "text"
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[#524434] text-[18px]" }, "search")))), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "w-full text-left border-collapse" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "bg-[#f1f4fa]/50" }, /* @__PURE__ */ React.createElement("th", { className: "px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider" }, "Date"), /* @__PURE__ */ React.createElement("th", { className: "px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider" }, "Hive ID"), /* @__PURE__ */ React.createElement("th", { className: "px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider" }, "Quantity (kg)"), /* @__PURE__ */ React.createElement("th", { className: "px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider" }, "Quality Grade"), /* @__PURE__ */ React.createElement("th", { className: "px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider" }, "Collector"), /* @__PURE__ */ React.createElement("th", { className: "px-6 py-4 text-[11px] font-bold text-[#524434] uppercase tracking-wider" }, "Actions"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-[#ebeef4]" }, harvestLedger.map((row, idx) => /* @__PURE__ */ React.createElement("tr", { key: idx, className: "hover:bg-[#f1f4fa]/30 transition-colors" }, /* @__PURE__ */ React.createElement("td", { className: "px-6 py-4 text-sm font-medium text-[#181c20]" }, row.date), /* @__PURE__ */ React.createElement("td", { className: "px-6 py-4" }, /* @__PURE__ */ React.createElement("span", { className: "bg-[#dfe3e8] px-2 py-1 rounded text-xs font-bold text-[#524434]" }, row.hiveId)), /* @__PURE__ */ React.createElement("td", { className: "px-6 py-4 text-sm font-bold text-[#181c20]" }, row.quantity), /* @__PURE__ */ React.createElement("td", { className: "px-6 py-4" }, /* @__PURE__ */ React.createElement("span", { className: cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold", row.gradeColor) }, /* @__PURE__ */ React.createElement("span", { className: cn("w-1.5 h-1.5 rounded-full", row.dotColor) }), row.grade)), /* @__PURE__ */ React.createElement("td", { className: "px-6 py-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "w-6 h-6 rounded-full bg-[#e5e8ee] flex items-center justify-center" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[14px]" }, "person")), /* @__PURE__ */ React.createElement("span", { className: "text-sm font-medium text-[#181c20]" }, row.collector))), /* @__PURE__ */ React.createElement("td", { className: "px-6 py-4" }, /* @__PURE__ */ React.createElement("button", { className: "text-[#524434] hover:text-[#835400] transition-colors" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "more_horiz")))))))), /* @__PURE__ */ React.createElement("div", { className: "px-6 py-4 flex items-center justify-between bg-[#f1f4fa]/20" }, /* @__PURE__ */ React.createElement("p", { className: "text-xs text-[#524434] font-medium" }, "Showing 4 of 128 entries"), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement("button", { className: "p-1.5 rounded-md border border-[#d7c3ae]/20 hover:bg-[#ebeef4] text-[#524434] transition-colors opacity-50", disabled: true }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "chevron_left")), /* @__PURE__ */ React.createElement("button", { className: "p-1.5 rounded-md border border-[#d7c3ae]/20 hover:bg-[#ebeef4] text-[#524434] transition-colors" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "chevron_right")))))));
}
export {
  HoneyContent as default
};
