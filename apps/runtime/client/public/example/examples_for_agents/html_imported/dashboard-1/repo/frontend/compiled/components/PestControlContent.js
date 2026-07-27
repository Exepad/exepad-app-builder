// repo/frontend/code/components/PestControlContent.tsx
import { React, Charts, cn } from "@exepad/sdk";
var { useState } = React;
var miteLoadData = [
  { month: "May", load: 1.2 },
  { month: "Jun", load: 1.8 },
  { month: "Jul", load: 2.5 },
  { month: "Aug", load: 3.1 },
  { month: "Sep", load: 4.2 },
  { month: "Oct", load: 3.4 }
];
var treatmentHistory = [
  {
    date: "Oct 24, 2023",
    hiveId: "#B-102",
    pest: "Varroa Mites",
    treatment: "Oxalic Acid Dribble",
    status: "Success",
    statusBg: "bg-[#a0f399]/50",
    statusText: "text-[#217128]"
  },
  {
    date: "Oct 21, 2023",
    hiveId: "#A-045",
    pest: "Small Hive Beetle",
    treatment: "Oil Trap Deployment",
    status: "In Progress",
    statusBg: "bg-[#dcb530]/50",
    statusText: "text-[#5a4700]"
  },
  {
    date: "Oct 15, 2023",
    hiveId: "#D-221",
    pest: "Nosema",
    treatment: "Fumidil-B Syrup",
    status: "Success",
    statusBg: "bg-[#a0f399]/50",
    statusText: "text-[#217128]"
  },
  {
    date: "Oct 08, 2023",
    hiveId: "#B-114",
    pest: "Wax Moth",
    treatment: "B401 Biological Control",
    status: "Failed",
    statusBg: "bg-[#ffdad6]/50",
    statusText: "text-[#93000a]"
  }
];
var checklistItems = [
  { label: "Equipment Sanitization", desc: "Tools torched or soaked in 10% bleach solution between hive stands.", defaultChecked: false },
  { label: "Entrance Hygiene", desc: "Cleared dead bees and debris from landing boards to prevent disease spread.", defaultChecked: false },
  { label: "Brood Pattern Check", desc: "Inspected for sunken cappings or foul odor (AFB/EFB screen).", defaultChecked: true },
  { label: "Robbing Prevention", desc: "Confirmed entrance reducers are installed on weaker colonies.", defaultChecked: false },
  { label: "Drone Monitoring", desc: "Assessed drone brood for excessive mite concentration.", defaultChecked: true }
];
function PestControlContent({ className }) {
  const [checklist, setChecklist] = useState(checklistItems.map((item) => item.defaultChecked));
  const toggleCheck = (index) => {
    setChecklist((prev) => prev.map((val, i) => i === index ? !val : val));
  };
  return /* @__PURE__ */ React.createElement("div", { className: cn("flex-1 min-h-screen bg-[#f7f9ff]", className), style: { fontFamily: "Inter" } }, /* @__PURE__ */ React.createElement("header", { className: "w-full sticky top-0 z-40 bg-slate-50/70 backdrop-blur-md shadow-sm border-b border-slate-200/50" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center px-6 py-3 w-full" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4 flex-1" }, /* @__PURE__ */ React.createElement("span", { className: "font-extrabold text-xl text-amber-700 tracking-tight", style: { fontFamily: "Manrope" } }, "The Golden Hive"), /* @__PURE__ */ React.createElement("div", { className: "hidden md:flex relative w-full max-w-md" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" }, "search"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-[#835400]/20 transition-all",
      placeholder: "Search apiary logs...",
      type: "text"
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, /* @__PURE__ */ React.createElement("button", { className: "p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "notifications")), /* @__PURE__ */ React.createElement("button", { className: "p-2 rounded-full text-slate-500 hover:bg-slate-200/50 transition-colors active:scale-95" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "history")), /* @__PURE__ */ React.createElement(
    "img",
    {
      alt: "User profile avatar",
      className: "w-8 h-8 rounded-full object-cover border-2 border-amber-500/20",
      src: "https://lh3.googleusercontent.com/aida-public/AB6AXuCNni2jRPwNIGyT0k1yYpEkACmqMUTbASQZO-oBHzk3AO_3CwR95-aTn2q4cNX2aKSUelKME26f0vJ9BWEL8zVusBjhEmQt5JhKCQfzJytQ_uzlBsM-rAAVSAAH2iI9MmAabgXa21hVD7dtdJ9WQ29jzpSB9eyTu1YZ4UsY-sHSE_E9nfh9-g7P5YvPFbpzsgnA-WV7nqNB3kCE5aS_3dR0P0qAV5MAyCHWgNdHB2bcbXf_caZmdv2d6LWerEigpkPkiGvmTFLzxr4Q"
    }
  )))), /* @__PURE__ */ React.createElement("div", { className: "p-6 lg:p-10 space-y-8" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col md:flex-row md:items-end justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { className: "font-extrabold text-3xl md:text-4xl text-[#181c20] tracking-tight", style: { fontFamily: "Manrope" } }, "Pest Control Monitoring"), /* @__PURE__ */ React.createElement("p", { className: "text-[#524434] mt-2 max-w-2xl" }, "Real-time health ledger for hive colony integrity. Monitor active infestations and maintain biosecurity protocols.")), /* @__PURE__ */ React.createElement("div", { className: "flex gap-3" }, /* @__PURE__ */ React.createElement("button", { className: "bg-white text-[#835400] border border-[#d7c3ae]/30 px-5 py-2.5 rounded-xl font-semibold shadow-sm hover:bg-[#f1f4fa] transition-colors flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm" }, "download"), "Export Report"), /* @__PURE__ */ React.createElement("button", { className: "bg-[#835400] text-white px-5 py-2.5 rounded-xl font-semibold shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm" }, "medical_services"), "Log Treatment"))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-12 gap-6" }, /* @__PURE__ */ React.createElement("div", { className: "lg:col-span-8 space-y-6" }, /* @__PURE__ */ React.createElement("section", { className: "bg-[#ffdad6]/20 rounded-3xl p-6 border border-[#ba1a1a]/10 overflow-hidden relative" }, /* @__PURE__ */ React.createElement("div", { className: "absolute top-0 right-0 p-8 opacity-5" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[#ba1a1a]", style: { fontSize: "96px", fontVariationSettings: "'FILL' 1" } }, "warning")), /* @__PURE__ */ React.createElement("div", { className: "relative z-10" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 mb-6" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[#ba1a1a]", style: { fontVariationSettings: "'FILL' 1" } }, "emergency"), /* @__PURE__ */ React.createElement("h3", { className: "font-bold text-xl text-[#93000a]", style: { fontFamily: "Manrope" } }, "Critical Interventions Required")), /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "bg-white p-5 rounded-2xl shadow-sm border-l-4 border-[#ba1a1a] flex flex-col md:flex-row md:items-start justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "bg-[#ffdad6] text-[#ba1a1a] p-3 rounded-xl h-fit" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined", style: { fontVariationSettings: "'FILL' 1" } }, "bug_report")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h4", { className: "font-bold text-lg text-[#181c20]" }, "Varroa Destructor Outbreak"), /* @__PURE__ */ React.createElement("p", { className: "text-[#524434] text-sm mt-1" }, "Hive #A-214 \u2022 Density: 12% phoretic mites"), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mt-3" }, /* @__PURE__ */ React.createElement("span", { className: "bg-[#ba1a1a]/10 text-[#ba1a1a] text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" }, "Immediate Action"), /* @__PURE__ */ React.createElement("span", { className: "bg-[#dfe3e8] text-[#524434] text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" }, "Detected 4h ago")))), /* @__PURE__ */ React.createElement("button", { className: "bg-[#ba1a1a] text-white px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity whitespace-nowrap" }, "Apply Formic Pro")), /* @__PURE__ */ React.createElement("div", { className: "bg-white p-5 rounded-2xl shadow-sm border-l-4 border-[#735c00] flex flex-col md:flex-row md:items-start justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "bg-[#dcb530]/30 text-[#735c00] p-3 rounded-xl h-fit" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined", style: { fontVariationSettings: "'FILL' 1" } }, "local_florist")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h4", { className: "font-bold text-lg text-[#181c20]" }, "Wax Moth Activity"), /* @__PURE__ */ React.createElement("p", { className: "text-[#524434] text-sm mt-1" }, "Hive #C-009 \u2022 Secondary weak colony signature"), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mt-3" }, /* @__PURE__ */ React.createElement("span", { className: "bg-[#735c00]/10 text-[#735c00] text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" }, "Monitoring"), /* @__PURE__ */ React.createElement("span", { className: "bg-[#dfe3e8] text-[#524434] text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" }, "Weekly Observation")))), /* @__PURE__ */ React.createElement("button", { className: "text-[#735c00] font-bold text-sm hover:underline py-2 px-4 border border-[#735c00]/20 rounded-lg whitespace-nowrap" }, "Inspect Combs"))))), /* @__PURE__ */ React.createElement("section", { className: "bg-white rounded-3xl p-6 shadow-sm border border-[#d7c3ae]/10" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center mb-8" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "font-bold text-[#181c20]", style: { fontFamily: "Manrope" } }, "Mite Load Trend"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-[#524434]" }, "Phoretic mite percentage across all hives")), /* @__PURE__ */ React.createElement("select", { className: "text-xs font-bold bg-[#f1f4fa] border-none rounded-lg focus:ring-0 px-3 py-1.5" }, /* @__PURE__ */ React.createElement("option", null, "Last 6 Months"), /* @__PURE__ */ React.createElement("option", null, "Last Year"))), /* @__PURE__ */ React.createElement("div", { className: "h-64 w-full" }, /* @__PURE__ */ React.createElement(Charts.ResponsiveContainer, { width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(Charts.BarChart, { data: miteLoadData, margin: { top: 5, right: 10, left: -10, bottom: 0 } }, /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("linearGradient", { id: "miteGradient", x1: "0", y1: "0", x2: "0", y2: "1" }, /* @__PURE__ */ React.createElement("stop", { offset: "0%", stopColor: "#ba1a1a", stopOpacity: 0.8 }), /* @__PURE__ */ React.createElement("stop", { offset: "100%", stopColor: "#ba1a1a", stopOpacity: 0.3 }))), /* @__PURE__ */ React.createElement(
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
      tick: { fontSize: 10, fill: "#524434", fontWeight: 700 },
      tickLine: false,
      axisLine: false,
      unit: "%"
    }
  ), /* @__PURE__ */ React.createElement(
    Charts.Tooltip,
    {
      contentStyle: {
        backgroundColor: "#ffffff",
        border: "1px solid #d7c3ae",
        borderRadius: "8px",
        fontSize: "12px",
        fontWeight: 600
      },
      formatter: (value) => [`${value}%`, "Mite Load"]
    }
  ), /* @__PURE__ */ React.createElement(
    Charts.Bar,
    {
      dataKey: "load",
      fill: "url(#miteGradient)",
      radius: [6, 6, 0, 0]
    }
  ))))), /* @__PURE__ */ React.createElement("section", { className: "bg-[#f1f4fa] rounded-3xl p-6" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between mb-6" }, /* @__PURE__ */ React.createElement("h3", { className: "font-bold text-xl text-[#181c20]", style: { fontFamily: "Manrope" } }, "Recent Treatment History"), /* @__PURE__ */ React.createElement("button", { className: "text-[#835400] text-sm font-semibold flex items-center gap-1 hover:gap-2 transition-all" }, "View All ", /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm" }, "arrow_forward"))), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "w-full text-left" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "text-[#524434] text-[10px] font-bold uppercase tracking-widest border-b border-[#d7c3ae]/10" }, /* @__PURE__ */ React.createElement("th", { className: "pb-4 px-2" }, "Date"), /* @__PURE__ */ React.createElement("th", { className: "pb-4 px-2" }, "Hive ID"), /* @__PURE__ */ React.createElement("th", { className: "pb-4 px-2" }, "Pest Type"), /* @__PURE__ */ React.createElement("th", { className: "pb-4 px-2" }, "Treatment"), /* @__PURE__ */ React.createElement("th", { className: "pb-4 px-2 text-right" }, "Status"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-[#d7c3ae]/10" }, treatmentHistory.map((row, idx) => /* @__PURE__ */ React.createElement("tr", { key: idx, className: "group hover:bg-[#dfe3e8]/30 transition-colors" }, /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2 font-medium text-sm" }, row.date), /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2 font-bold text-[#835400]" }, row.hiveId), /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2 text-sm" }, row.pest), /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2 text-sm italic" }, row.treatment), /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2 text-right" }, /* @__PURE__ */ React.createElement("span", { className: cn("px-2.5 py-1 rounded-full text-xs font-semibold", row.statusBg, row.statusText) }, row.status))))))))), /* @__PURE__ */ React.createElement("div", { className: "lg:col-span-4 space-y-6" }, /* @__PURE__ */ React.createElement("section", { className: "bg-white rounded-3xl p-6 shadow-sm border border-[#d7c3ae]/20 h-full" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 mb-6" }, /* @__PURE__ */ React.createElement("div", { className: "w-10 h-10 bg-[#a3f69c] text-[#002204] rounded-xl flex items-center justify-center" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "checklist")), /* @__PURE__ */ React.createElement("h3", { className: "font-bold text-xl text-[#181c20]", style: { fontFamily: "Manrope" } }, "Biosecurity Checklist")), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-[#524434] font-medium uppercase tracking-widest mb-4" }, "Inspection Protocol v4.2"), /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, checklistItems.map((item, idx) => /* @__PURE__ */ React.createElement(
    "label",
    {
      key: idx,
      className: "flex items-start gap-3 p-4 rounded-2xl hover:bg-[#f1f4fa] transition-colors cursor-pointer group border border-transparent hover:border-[#d7c3ae]/10"
    },
    /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: checklist[idx],
        onChange: () => toggleCheck(idx),
        className: "mt-1 w-5 h-5 rounded text-[#1b6d24] focus:ring-[#1b6d24] border-[#d7c3ae]"
      }
    ),
    /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "block font-bold text-[#181c20] group-hover:text-[#1b6d24] transition-colors" }, item.label), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-[#524434] mt-1" }, item.desc))
  ))), /* @__PURE__ */ React.createElement("div", { className: "mt-8 p-4 bg-[#ffddb5]/20 rounded-2xl border border-[#ffb957]" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 mb-2" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[#835400] text-sm" }, "info"), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-bold text-[#2a1800] uppercase tracking-tight" }, "Apiary Note")), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-[#643f00] leading-relaxed italic" }, '"The hive is a mirror. If the beekeeper is chaotic, the bees will reflect it. Stay vigilant, stay clean."'))))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6" }, /* @__PURE__ */ React.createElement("div", { className: "bg-[#dfe3e8]/50 p-6 rounded-3xl backdrop-blur-sm border border-[#d7c3ae]/10" }, /* @__PURE__ */ React.createElement("p", { className: "text-[10px] font-bold text-[#524434] uppercase tracking-widest mb-1" }, "Total Mite Load"), /* @__PURE__ */ React.createElement("div", { className: "flex items-baseline gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-3xl font-black text-[#181c20]", style: { fontFamily: "Manrope" } }, "3.4%"), /* @__PURE__ */ React.createElement("span", { className: "text-[#1b6d24] text-xs font-bold" }, "(-0.8% MoM)"))), /* @__PURE__ */ React.createElement("div", { className: "bg-[#dfe3e8]/50 p-6 rounded-3xl backdrop-blur-sm border border-[#d7c3ae]/10" }, /* @__PURE__ */ React.createElement("p", { className: "text-[10px] font-bold text-[#524434] uppercase tracking-widest mb-1" }, "Treatment Efficacy"), /* @__PURE__ */ React.createElement("div", { className: "flex items-baseline gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-3xl font-black text-[#181c20]", style: { fontFamily: "Manrope" } }, "92%"), /* @__PURE__ */ React.createElement("span", { className: "text-[#1b6d24] text-xs font-bold" }, "(High Quality)"))), /* @__PURE__ */ React.createElement("div", { className: "bg-[#dfe3e8]/50 p-6 rounded-3xl backdrop-blur-sm border border-[#d7c3ae]/10" }, /* @__PURE__ */ React.createElement("p", { className: "text-[10px] font-bold text-[#524434] uppercase tracking-widest mb-1" }, "Intervention Index"), /* @__PURE__ */ React.createElement("div", { className: "flex items-baseline gap-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-3xl font-black text-[#181c20]", style: { fontFamily: "Manrope" } }, "2"), /* @__PURE__ */ React.createElement("span", { className: "text-[#ba1a1a] text-xs font-bold" }, "(Action Needed)"))))));
}
export {
  PestControlContent as default
};
