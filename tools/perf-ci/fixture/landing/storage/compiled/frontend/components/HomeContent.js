// ../../../../../tmp/exepad-build-a1kguu163-qr2bL9/HomeContent.tsx
import { React, LightDOMContainer, Icons, navigate } from "@exepad/sdk";
function HomeContent() {
  return /* @__PURE__ */ React.createElement(LightDOMContainer, null, /* @__PURE__ */ React.createElement("section", { className: "relative min-h-[85vh] flex items-center justify-center overflow-x-clip bg-gradient-to-br from-primary via-[#236a4f] to-[#1a5a40]" }, /* @__PURE__ */ React.createElement("div", { className: "absolute inset-0 overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "absolute -top-40 -right-40 w-96 h-96 rounded-full bg-secondary/30 blur-3xl" }), /* @__PURE__ */ React.createElement("div", { className: "absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-primary-container/30 blur-3xl" }), /* @__PURE__ */ React.createElement("div", { className: "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-on-primary/30 blur-3xl" })), /* @__PURE__ */ React.createElement("div", { className: "relative z-10 max-w-4xl mx-auto px-4 md:px-6 lg:px-10 text-center" }, /* @__PURE__ */ React.createElement("div", { className: "inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-on-primary/30 text-on-primary text-xs font-semibold tracking-wider uppercase mb-6 md:mb-8" }, /* @__PURE__ */ React.createElement("span", { className: "w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" }), "Welcome to Verdant"), /* @__PURE__ */ React.createElement("h1", { className: "font-headline text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-extrabold text-on-primary leading-tight mb-6" }, "Cultivating Growth,", " ", /* @__PURE__ */ React.createElement("span", { className: "text-secondary" }, "Naturally")), /* @__PURE__ */ React.createElement("p", { className: "text-base md:text-lg lg:text-xl text-on-primary max-w-2xl mx-auto leading-relaxed mb-8 md:mb-10" }, "We partner with forward-thinking businesses to build sustainable solutions that nurture both people and the planet. From strategy to execution, your vision grows here."), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row items-center justify-center gap-4" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => navigate("/services"),
      className: "inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-secondary text-on-secondary text-base font-bold hover:opacity-90 transition-all active:scale-[0.98] shadow-lg shadow-secondary/25"
    },
    "Explore Our Services",
    /* @__PURE__ */ React.createElement(Icons.ArrowRight, { className: "w-5 h-5" })
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => navigate("/about"),
      className: "inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl border-2 border-on-primary/30 text-on-primary text-base font-semibold hover:bg-on-primary/30 transition-all active:scale-[0.98]"
    },
    "Learn More",
    /* @__PURE__ */ React.createElement(Icons.ChevronRight, { className: "w-5 h-5" })
  )), /* @__PURE__ */ React.createElement("div", { className: "mt-16 md:mt-20 flex flex-col items-center gap-2 text-on-primary" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-medium tracking-widest uppercase" }, "Scroll to explore"), /* @__PURE__ */ React.createElement("div", { className: "w-5 h-8 rounded-full border-2 border-on-primary/30 flex items-start justify-center p-1" }, /* @__PURE__ */ React.createElement("div", { className: "w-1.5 h-1.5 rounded-full bg-on-primary/60 animate-bounce" }))))));
}
var HomeContent_default = HomeContent;
export {
  HomeContent_default as default
};
