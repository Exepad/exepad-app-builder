// repo/frontend/code/components/KineticSidebar.tsx
import { React, cn, navigate } from "@exepad/sdk";
var navItems = [
  { label: "Overview", icon: "dashboard", href: "/" },
  { label: "Keywords", icon: "key", href: "/keywords" },
  { label: "Backlinks", icon: "link", href: null },
  { label: "Competitors", icon: "analytics", href: null },
  { label: "Landing", icon: "web", href: "/landing" },
  { label: "Pricing", icon: "payments", href: "/pricing" },
  { label: "Settings", icon: "settings", href: null }
];
function KineticSidebar({ className }) {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const currentPath = path.replace(/^\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+/, "") || "/";
  return /* @__PURE__ */ React.createElement("aside", { className: cn("h-full w-64 shrink-0 hidden lg:flex flex-col bg-[#131313]", className), style: { fontFamily: "Inter" } }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col h-full p-6 space-y-8" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "w-8 h-8 rounded bg-gradient-to-br from-[#cc97ff] to-[#9c48ea] flex items-center justify-center" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-black text-sm" }, "bolt")), /* @__PURE__ */ React.createElement("span", { className: "font-bold text-[#cc97ff] tracking-tight", style: { fontFamily: "Manrope" } }, "KINETIC")), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col space-y-1" }, /* @__PURE__ */ React.createElement("span", { className: "text-white font-bold text-sm tracking-tight", style: { fontFamily: "Manrope" } }, "Project Alpha"), /* @__PURE__ */ React.createElement("span", { className: "text-[#adaaaa] text-xs" }, "SEO Command Center")), /* @__PURE__ */ React.createElement("button", { className: "w-full py-2.5 px-4 bg-gradient-to-r from-[#cc97ff] to-[#9c48ea] text-black font-semibold text-sm rounded-lg transition-transform active:scale-95" }, "New Audit")), /* @__PURE__ */ React.createElement("nav", { className: "flex-1 space-y-1" }, /* @__PURE__ */ React.createElement("p", { className: "text-[10px] uppercase tracking-widest text-[#adaaaa] font-bold mb-4 px-2" }, "Main Menu"), navItems.map((item) => {
    const isActive = item.href !== null && currentPath === item.href;
    const isClickable = item.href !== null;
    return /* @__PURE__ */ React.createElement(
      "a",
      {
        key: item.label,
        className: cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ease-in-out",
          isActive ? "bg-[#1a1919] text-[#cc97ff] shadow-[0_0_15px_rgba(204,151,255,0.1)] font-medium" : "text-[#adaaaa] hover:text-white hover:bg-[#1a1919]",
          isClickable ? "cursor-pointer" : "cursor-default opacity-60"
        ),
        onClick: (e) => {
          e.preventDefault();
          if (isClickable) navigate(item.href);
        }
      },
      /* @__PURE__ */ React.createElement(
        "span",
        {
          className: "material-symbols-outlined text-[20px]",
          style: isActive ? { fontVariationSettings: "'FILL' 1" } : void 0
        },
        item.icon
      ),
      /* @__PURE__ */ React.createElement("span", { className: "text-sm font-medium" }, item.label)
    );
  })), /* @__PURE__ */ React.createElement("div", { className: "mt-auto pt-6 border-t border-white/5 space-y-2" }, /* @__PURE__ */ React.createElement("a", { className: "flex items-center gap-3 px-3 py-2 text-[#adaaaa] hover:text-[#3adffa] text-sm transition-colors cursor-pointer" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "help"), /* @__PURE__ */ React.createElement("span", { className: "text-xs" }, "Support")), /* @__PURE__ */ React.createElement("a", { className: "flex items-center gap-3 px-3 py-2 text-[#adaaaa] hover:text-[#3adffa] text-sm transition-colors cursor-pointer" }, /* @__PURE__ */ React.createElement("span", { className: "material-symbols-outlined text-[18px]" }, "description"), /* @__PURE__ */ React.createElement("span", { className: "text-xs" }, "Documentation")))));
}
export {
  KineticSidebar as default
};
