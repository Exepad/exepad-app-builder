// repo/frontend/code/components/DashboardSidebar.tsx
import { React, cn, navigate } from "@exepad/sdk";
var navItems = [
  { label: "Overview", icon: "dashboard", href: "/" },
  { label: "Hives", icon: "grid_view", href: "/hives" },
  { label: "Honey Production", icon: "water_drop", href: "/honey-production" },
  { label: "Pest Control", icon: "bug_report", href: "/pest-control" },
  { label: "Settings", icon: "settings", href: "/settings" }
];
function DashboardSidebar({ className }) {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const currentPath = path.replace(/^\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+/, "") || "/";
  return /* @__PURE__ */ React.createElement("aside", { className: cn("h-screen w-64 shrink-0 hidden lg:flex flex-col bg-slate-50 border-r border-slate-100", className) }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col h-full py-8 px-4 gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "px-4 mb-8" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3 mb-4" }, /* @__PURE__ */ React.createElement("div", { className: "w-10 h-10 rounded-xl bg-[#835400] flex items-center justify-center shadow-lg shadow-[#835400]/20" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-white" }, "hive")), /* @__PURE__ */ React.createElement("h1", { className: "font-black text-amber-700 text-xl tracking-tight leading-none", style: { fontFamily: "Manrope" } }, "The Living Ledger")), /* @__PURE__ */ React.createElement("div", { className: "p-3 bg-[#a0f399]/30 rounded-lg" }, /* @__PURE__ */ React.createElement("p", { className: "text-[10px] font-bold text-[#217128]/60 uppercase tracking-widest mb-1" }, "CURRENT STATUS"), /* @__PURE__ */ React.createElement("p", { className: "font-bold text-sm text-[#217128]", style: { fontFamily: "Manrope" } }, "Hive Alpha Status: Thriving"))), /* @__PURE__ */ React.createElement("nav", { className: "flex-1 space-y-1" }, navItems.map((item) => {
    const isActive = currentPath === item.href;
    return /* @__PURE__ */ React.createElement(
      "a",
      {
        key: item.label,
        className: cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer",
          isActive ? "text-amber-800 font-bold border-r-4 border-amber-600 bg-amber-50/50" : "text-slate-600 hover:text-amber-600 hover:bg-slate-100"
        ),
        onClick: (e) => {
          e.preventDefault();
          navigate(item.href);
        }
      },
      /* @__PURE__ */ React.createElement(
        "span",
        {
          className: "material-symbols-outlined",
          style: isActive ? { fontVariationSettings: "'FILL' 1" } : void 0
        },
        item.icon
      ),
      /* @__PURE__ */ React.createElement("span", { className: "text-sm font-medium tracking-wide" }, item.label)
    );
  })), /* @__PURE__ */ React.createElement("button", { className: "mt-4 mx-2 bg-[#835400] text-white py-3 px-4 rounded-xl font-bold text-sm shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2", style: { fontFamily: "Manrope" } }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-lg" }, "add"), "Add Inspection"), /* @__PURE__ */ React.createElement("div", { className: "mt-auto pt-4 border-t border-slate-100 space-y-1" }, /* @__PURE__ */ React.createElement("a", { className: "flex items-center gap-3 px-4 py-2 rounded-xl text-slate-500 hover:text-slate-900 transition-colors cursor-pointer" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[20px]" }, "help"), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-medium" }, "Help Center")), /* @__PURE__ */ React.createElement("a", { className: "flex items-center gap-3 px-4 py-2 rounded-xl text-slate-500 hover:text-[#ba1a1a] transition-colors cursor-pointer" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[20px]" }, "logout"), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-medium" }, "Logout")))));
}
export {
  DashboardSidebar as default
};
