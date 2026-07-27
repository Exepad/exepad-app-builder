// ../../../../../tmp/exepad-build-a1kguu163-qr2bL9/ServicesContent.tsx
import { React, LightDOMContainer, Icons, navigate } from "@exepad/sdk";
var SERVICES = [
  {
    icon: Icons.Trees,
    title: "Landscape Design",
    description: "Custom garden and outdoor space planning tailored to your property. We create immersive natural environments that blend beauty with function, from intimate courtyard gardens to expansive estate landscapes."
  },
  {
    icon: Icons.Sprout,
    title: "Garden Maintenance",
    description: "Regular care including pruning, weeding, mulching, and seasonal cleanup. Our stewardship programs keep your garden thriving year-round with meticulous attention to every detail."
  },
  {
    icon: Icons.Flower2,
    title: "Native Plant Installation",
    description: "Drought-resistant, ecologically beneficial native species for sustainable landscapes. We restore local biodiversity while reducing water usage and long-term maintenance costs."
  },
  {
    icon: Icons.Droplets,
    title: "Irrigation Systems",
    description: "Smart water management solutions that conserve resources while keeping gardens vibrant. From drip systems to automated controllers, we design for efficiency and precision."
  },
  {
    icon: Icons.Wallpaper,
    title: "Hardscaping",
    description: "Patios, walkways, retaining walls, and outdoor living features crafted from natural stone and premium materials. We extend your living space into the landscape."
  },
  {
    icon: Icons.Globe,
    title: "Eco-Restoration",
    description: "Soil remediation, habitat restoration, and rewilding projects for properties of all scales. We partner with nature to heal degraded land and foster resilient ecosystems."
  }
];
function ServicesContent() {
  return /* @__PURE__ */ React.createElement(LightDOMContainer, null, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col" }, /* @__PURE__ */ React.createElement("section", { className: "relative overflow-hidden bg-gradient-to-b from-primary-container/20 to-surface pt-20 pb-12 md:pt-28 md:pb-16" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-6 md:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-3xl mx-auto text-center" }, /* @__PURE__ */ React.createElement("div", { className: "inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/30 text-primary text-xs font-bold uppercase tracking-widest mb-6" }, /* @__PURE__ */ React.createElement(Icons.Sparkles, { className: "w-3.5 h-3.5" }), "What We Offer"), /* @__PURE__ */ React.createElement("h1", { className: "font-headline text-4xl md:text-5xl lg:text-6xl font-extrabold text-on-surface leading-tight mb-6" }, "Our Services"), /* @__PURE__ */ React.createElement("p", { className: "text-lg md:text-xl text-on-surface-variant leading-relaxed max-w-2xl mx-auto" }, "From intimate garden redesigns to full-scale ecological restoration, we partner with you to create landscapes that nourish both people and planet."))), /* @__PURE__ */ React.createElement("div", { className: "absolute -bottom-6 left-1/2 -translate-x-1/2 w-[120%] h-12 bg-surface rounded-t-[50%]" })), /* @__PURE__ */ React.createElement("section", { className: "py-16 md:py-24 bg-surface" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-6 md:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8" }, SERVICES.map((service, idx) => {
    const IconComponent = service.icon;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: idx,
        className: "group bg-surface rounded-2xl p-6 md:p-8 shadow-sm border border-outline-variant/10 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
      },
      /* @__PURE__ */ React.createElement("div", { className: "w-14 h-14 rounded-xl bg-primary/30 flex items-center justify-center mb-5 group-hover:bg-primary group-hover:text-on-surface transition-all duration-300" }, /* @__PURE__ */ React.createElement(IconComponent, { className: "w-7 h-7 text-primary group-hover:text-on-surface transition-colors duration-300" })),
      /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-xl font-bold text-on-surface mb-3 group-hover:text-primary transition-colors" }, service.title),
      /* @__PURE__ */ React.createElement("p", { className: "text-sm text-on-surface-variant leading-relaxed" }, service.description)
    );
  })))), /* @__PURE__ */ React.createElement("section", { className: "py-16 md:py-24 bg-gradient-to-b from-surface to-primary-container/10" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-6 md:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-3xl mx-auto text-center" }, /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-3xl md:text-4xl font-extrabold text-on-surface mb-4" }, "Ready to Start Your Project?"), /* @__PURE__ */ React.createElement("p", { className: "text-lg text-on-surface-variant mb-8 max-w-xl mx-auto" }, "Tell us about your vision \u2014 we'll craft a plan that brings it to life, from concept to completion."), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row items-center justify-center gap-4" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => navigate("/contact"),
      className: "inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-primary text-on-primary text-base font-semibold hover:opacity-90 transition-all active:scale-[0.98] shadow-sm"
    },
    "Get in Touch",
    /* @__PURE__ */ React.createElement(Icons.ArrowRight, { className: "w-5 h-5" })
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => navigate("/features"),
      className: "inline-flex items-center gap-2 px-8 py-4 rounded-2xl border border-outline-variant/30 text-on-surface text-base font-semibold hover:bg-surface-container-low transition-all active:scale-[0.98]"
    },
    "Explore Features",
    /* @__PURE__ */ React.createElement(Icons.ChevronRight, { className: "w-5 h-5" })
  )))))));
}
var ServicesContent_default = ServicesContent;
export {
  ServicesContent_default as default
};
