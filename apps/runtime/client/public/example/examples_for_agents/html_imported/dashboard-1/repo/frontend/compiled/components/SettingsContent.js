// repo/frontend/code/components/SettingsContent.tsx
import { React, cn } from "@exepad/sdk";
var { useState } = React;
function SettingsContent({ className }) {
  const [fullName, setFullName] = useState("Alistair Thorne");
  const [certId, setCertId] = useState("GOLD-88291-UK");
  const [email, setEmail] = useState("thorne.a@goldenhive.com");
  const [location, setLocation] = useState("Cotswolds, UK");
  const [activeHives, setActiveHives] = useState("12");
  const [floraType, setFloraType] = useState("Mixed Wildflower");
  const [weightLossEnabled, setWeightLossEnabled] = useState(true);
  return /* @__PURE__ */ React.createElement("div", { className: cn("flex-1 min-h-screen bg-[#f7f9ff]", className), style: { fontFamily: "Inter" } }, /* @__PURE__ */ React.createElement("header", { className: "w-full sticky top-0 z-40 bg-slate-50/70 backdrop-blur-md shadow-sm border-b border-slate-200/50" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center px-6 py-3 w-full" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4" }, /* @__PURE__ */ React.createElement("h2", { className: "font-bold text-lg text-amber-700", style: { fontFamily: "Manrope" } }, "Settings")), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "relative hidden sm:block" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#524434] text-sm" }, "search"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "pl-10 pr-4 py-2 bg-[#dfe3e8] border-none rounded-full text-sm focus:ring-2 focus:ring-[#835400]/20 w-64 transition-all",
      placeholder: "Search settings...",
      type: "text"
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("button", { className: "p-2 rounded-full hover:bg-slate-200/50 transition-colors active:scale-95" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[#524434]" }, "notifications")), /* @__PURE__ */ React.createElement("button", { className: "p-2 rounded-full hover:bg-slate-200/50 transition-colors active:scale-95" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[#524434]" }, "history")), /* @__PURE__ */ React.createElement("div", { className: "w-8 h-8 rounded-full bg-[#ffddb5] overflow-hidden ml-2" }, /* @__PURE__ */ React.createElement(
    "img",
    {
      alt: "User profile avatar",
      className: "w-full h-full object-cover",
      src: "https://lh3.googleusercontent.com/aida-public/AB6AXuBTYXaJmD7O-QWPtdYHnHNdlVDBNcidRgbsKLHzJp6EymuWNP-UXv5Jsy8S1aufSY4VqrFfdaP3J340xNjQCq2Aa_g-iHknoIy0y4iQWg-agAeAN7pUVtfVs-sMPi1-45XY5UvfoCx3DbsLgNG1OnDILp2_rQqmqLhbQ4Ks8kEB4_4EF-gE_idryoT7B9pojw53jgv_LBgcqg5buH4dkoeL5ZejJDw26Z78yb8AC3U42ocHtzB3n4hF7GstVuI04puD4AEMgwhPUIe_"
    }
  )))))), /* @__PURE__ */ React.createElement("div", { className: "flex-1 p-6 lg:p-10 space-y-10 max-w-6xl mx-auto w-full" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col md:flex-row md:items-end justify-between gap-6" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-bold tracking-widest text-[#835400] uppercase" }, "Configuration Shell"), /* @__PURE__ */ React.createElement("h3", { className: "font-extrabold text-4xl text-[#181c20] tracking-tight", style: { fontFamily: "Manrope" } }, "The Living Ledger Control"), /* @__PURE__ */ React.createElement("p", { className: "text-[#524434] max-w-xl" }, "Manage your apiary identity, sensor synchronization, and hive health thresholds from this centralized ledger.")), /* @__PURE__ */ React.createElement("div", { className: "flex gap-3" }, /* @__PURE__ */ React.createElement("button", { className: "px-6 py-2.5 rounded-lg border border-[#d7c3ae]/30 text-[#524434] font-semibold text-sm hover:bg-[#f1f4fa] transition-colors" }, "Discard Changes"), /* @__PURE__ */ React.createElement("button", { className: "px-6 py-2.5 rounded-lg bg-gradient-to-r from-[#835400] to-[#f9a825] text-white font-bold text-sm shadow-lg shadow-[#835400]/10 active:scale-95 transition-all" }, "Save Ledger"))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 xl:grid-cols-12 gap-8 items-start" }, /* @__PURE__ */ React.createElement("div", { className: "xl:col-span-8 space-y-8" }, /* @__PURE__ */ React.createElement("section", { className: "bg-white rounded-xl p-8 shadow-sm ring-1 ring-slate-100/50" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4 mb-8" }, /* @__PURE__ */ React.createElement("div", { className: "w-12 h-12 rounded-lg bg-[#ffddb5] flex items-center justify-center text-[#835400]" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "person")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h4", { className: "font-bold text-xl", style: { fontFamily: "Manrope" } }, "Master Apiarist Profile"), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-[#524434]" }, "Update your professional credentials and public display"))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-bold text-[#524434] uppercase tracking-wider" }, "Full Name"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all",
      type: "text",
      value: fullName,
      onChange: (e) => setFullName(e.target.value)
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-bold text-[#524434] uppercase tracking-wider" }, "Certification ID"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all",
      type: "text",
      value: certId,
      onChange: (e) => setCertId(e.target.value)
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "md:col-span-2 space-y-2" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-bold text-[#524434] uppercase tracking-wider" }, "Email Address"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all",
      type: "email",
      value: email,
      onChange: (e) => setEmail(e.target.value)
    }
  )))), /* @__PURE__ */ React.createElement("section", { className: "bg-white rounded-xl p-8 shadow-sm ring-1 ring-slate-100/50" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4 mb-8" }, /* @__PURE__ */ React.createElement("div", { className: "w-12 h-12 rounded-lg bg-[#a0f399] flex items-center justify-center text-[#217128]" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "potted_plant")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h4", { className: "font-bold text-xl", style: { fontFamily: "Manrope" } }, "Apiary Configuration"), /* @__PURE__ */ React.createElement("p", { className: "text-sm text-[#524434]" }, "Define regional parameters and hive scale"))), /* @__PURE__ */ React.createElement("div", { className: "space-y-8" }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-bold text-[#524434] uppercase tracking-wider" }, "Primary Location"), /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#524434] text-sm" }, "location_on"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "w-full bg-[#dfe3e8] border-none rounded-lg pl-10 pr-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all",
      type: "text",
      value: location,
      onChange: (e) => setLocation(e.target.value)
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-bold text-[#524434] uppercase tracking-wider" }, "Active Hives"), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all",
      type: "number",
      value: activeHives,
      onChange: (e) => setActiveHives(e.target.value)
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-bold text-[#524434] uppercase tracking-wider" }, "Flora Type"), /* @__PURE__ */ React.createElement(
    "select",
    {
      className: "w-full bg-[#dfe3e8] border-none rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-[#835400] focus:bg-white transition-all",
      value: floraType,
      onChange: (e) => setFloraType(e.target.value)
    },
    /* @__PURE__ */ React.createElement("option", null, "Mixed Wildflower"),
    /* @__PURE__ */ React.createElement("option", null, "Lavender"),
    /* @__PURE__ */ React.createElement("option", null, "Heather"),
    /* @__PURE__ */ React.createElement("option", null, "Clover")
  ))), /* @__PURE__ */ React.createElement("div", { className: "pt-6 border-t border-[#d7c3ae]/10" }, /* @__PURE__ */ React.createElement("h5", { className: "font-bold text-sm mb-4", style: { fontFamily: "Manrope" } }, "Health Notification Thresholds"), /* @__PURE__ */ React.createElement("div", { className: "space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "font-semibold text-sm" }, "Critical Temperature Alert"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-[#524434]" }, "Trigger alert if hive temperature deviates by more than 5\xB0C")), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-mono font-bold text-[#835400] bg-[#ffddb5]/30 px-2 py-1 rounded" }, "35\xB0C Target"), /* @__PURE__ */ React.createElement("input", { className: "accent-[#835400] w-24", type: "range" }))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "font-semibold text-sm" }, "Weight Loss Warning"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-[#524434]" }, "Detect sudden drops indicative of potential swarming")), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden",
        weightLossEnabled ? "bg-[#1b6d24]" : "bg-[#dfe3e8]"
      ),
      onClick: () => setWeightLossEnabled(!weightLossEnabled)
    },
    /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cn(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
          weightLossEnabled ? "translate-x-5" : "translate-x-0"
        )
      }
    )
  ))))))), /* @__PURE__ */ React.createElement("div", { className: "xl:col-span-4 space-y-8" }, /* @__PURE__ */ React.createElement("section", { className: "bg-white rounded-xl p-8 shadow-sm ring-1 ring-slate-100/50" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4 mb-6" }, /* @__PURE__ */ React.createElement("div", { className: "w-10 h-10 rounded-lg bg-[#ffe087] flex items-center justify-center text-[#241a00]" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "sync")), /* @__PURE__ */ React.createElement("h4", { className: "font-bold text-lg", style: { fontFamily: "Manrope" } }, "Sensor Network")), /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "p-4 bg-[#f1f4fa] rounded-lg flex items-center justify-between" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[#1b6d24]" }, "check_circle"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "text-sm font-bold" }, "BeeLink Hub v2"), /* @__PURE__ */ React.createElement("p", { className: "text-[10px] text-[#524434]" }, "Last sync: 2 mins ago"))), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] font-bold text-[#1b6d24] uppercase tracking-tighter bg-[#a3f69c]/30 px-2 py-0.5 rounded" }, "Active")), /* @__PURE__ */ React.createElement("button", { className: "w-full py-3 text-sm font-bold text-[#835400] border border-[#835400]/20 rounded-lg flex items-center justify-center gap-2 hover:bg-[#ffddb5]/20 transition-colors" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm" }, "add"), "Add New Sensor"), /* @__PURE__ */ React.createElement("div", { className: "pt-4 mt-4 border-t border-[#d7c3ae]/10" }, /* @__PURE__ */ React.createElement("button", { className: "w-full py-3 text-sm font-semibold text-[#524434] hover:text-[#181c20] flex items-center gap-3" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm" }, "download"), "Export CSV Activity Logs"), /* @__PURE__ */ React.createElement("button", { className: "w-full py-3 text-sm font-semibold text-[#524434] hover:text-[#181c20] flex items-center gap-3" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm" }, "api"), "Manage API Keys")))), /* @__PURE__ */ React.createElement("section", { className: "bg-white rounded-xl p-8 shadow-sm ring-1 ring-slate-100/50" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-4 mb-6" }, /* @__PURE__ */ React.createElement("div", { className: "w-10 h-10 rounded-lg bg-[#dfe3e8] flex items-center justify-center text-[#524434]" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined" }, "contact_support")), /* @__PURE__ */ React.createElement("h4", { className: "font-bold text-lg", style: { fontFamily: "Manrope" } }, "Hive Assistance")), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("a", { className: "flex items-center justify-between p-3 rounded-lg hover:bg-[#f1f4fa] transition-colors group cursor-pointer" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm font-medium" }, "Documentation & Guides"), /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" }, "arrow_forward")), /* @__PURE__ */ React.createElement("a", { className: "flex items-center justify-between p-3 rounded-lg hover:bg-[#f1f4fa] transition-colors group cursor-pointer" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm font-medium" }, "Community Forum"), /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" }, "arrow_forward")), /* @__PURE__ */ React.createElement("a", { className: "flex items-center justify-between p-3 rounded-lg hover:bg-[#f1f4fa] transition-colors group cursor-pointer" }, /* @__PURE__ */ React.createElement("span", { className: "text-sm font-medium" }, "Technical Support"), /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-sm opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" }, "arrow_forward")), /* @__PURE__ */ React.createElement("div", { className: "mt-6 p-4 bg-[#ffddb5]/10 rounded-xl border-l-4 border-[#835400]" }, /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-[#643f00] mb-1" }, "PRO TIP"), /* @__PURE__ */ React.createElement("p", { className: "text-[11px] leading-relaxed text-[#643f00]" }, "Regularly export your hive logs to maintain a physical backup of your production history."))))))));
}
export {
  SettingsContent as default
};
