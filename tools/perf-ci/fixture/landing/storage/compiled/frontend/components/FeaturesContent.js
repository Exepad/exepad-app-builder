// ../../../../../tmp/exepad-build-a1kguu163-qr2bL9/FeaturesContent.tsx
import { React, LightDOMContainer, Icons, navigate } from "@exepad/sdk";
function FeaturesContent() {
  const features = [
    {
      icon: Icons.TrendingUp,
      title: "Data-Driven Insights",
      description: "Make informed decisions with real-time sustainability metrics and analytics that reveal opportunities for growth and efficiency across your entire operation."
    },
    {
      icon: Icons.LifeBuoy,
      title: "End-to-End Support",
      description: "From initial environmental assessment to full implementation and monitoring \u2014 our team walks with you through every phase of your sustainability journey."
    },
    {
      icon: Icons.ShieldCheck,
      title: "Certified Expertise",
      description: "Our consultants hold industry-verified sustainability credentials, bringing rigorous standards and proven methodologies to every engagement."
    },
    {
      icon: Icons.BarChart3,
      title: "Measurable Impact",
      description: "Track, report, and celebrate your environmental footprint reductions with transparent dashboards that make your progress visible to stakeholders."
    },
    {
      icon: Icons.Sparkles,
      title: "Custom Solutions",
      description: "No two businesses are alike. We craft tailored sustainability strategies that align with your unique industry, size, culture, and growth ambitions."
    },
    {
      icon: Icons.Handshake,
      title: "Long-Term Partnership",
      description: "Sustainability is a marathon, not a sprint. We provide ongoing guidance and recalibration as your goals evolve, ensuring lasting value year after year."
    }
  ];
  return /* @__PURE__ */ React.createElement(LightDOMContainer, null, /* @__PURE__ */ React.createElement("section", { className: "bg-surface py-16 md:py-20 lg:py-24" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-4 md:px-6 lg:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-3xl mx-auto text-center mb-12 md:mb-16" }, /* @__PURE__ */ React.createElement("span", { className: "inline-block text-xs md:text-sm font-bold text-primary uppercase tracking-[0.15em] mb-4" }, "Why Choose Verdant"), /* @__PURE__ */ React.createElement("h1", { className: "font-headline text-3xl md:text-4xl lg:text-5xl font-extrabold text-on-surface leading-tight mb-5" }, "Built to Help You Thrive"), /* @__PURE__ */ React.createElement("p", { className: "text-base md:text-lg text-on-surface-variant leading-relaxed max-w-2xl mx-auto" }, "Every feature we offer is designed with one goal in mind: making sustainability practical, profitable, and permanent for your business. Here is what sets us apart.")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8" }, features.map((feature, idx) => {
    const IconComponent = feature.icon;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: idx,
        className: "group bg-surface-bright rounded-2xl p-6 md:p-8 shadow-sm border border-outline-variant/10 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
      },
      /* @__PURE__ */ React.createElement("div", { className: "mb-5 inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-container/40 group-hover:bg-primary-container/70 transition-colors" }, /* @__PURE__ */ React.createElement(IconComponent, { className: "w-6 h-6 text-primary" })),
      /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-xl font-bold text-on-surface mb-3" }, feature.title),
      /* @__PURE__ */ React.createElement("p", { className: "text-sm md:text-base text-on-surface-variant leading-relaxed" }, feature.description)
    );
  })))), /* @__PURE__ */ React.createElement("section", { className: "bg-primary py-16 md:py-20" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-4xl mx-auto px-4 md:px-6 lg:px-10 text-center" }, /* @__PURE__ */ React.createElement("h2", { className: "font-headline text-2xl md:text-3xl lg:text-4xl font-extrabold text-on-primary leading-tight mb-4" }, "Ready to Make Sustainability Your Advantage?"), /* @__PURE__ */ React.createElement("p", { className: "text-base md:text-lg text-on-primary max-w-2xl mx-auto mb-8" }, "Partner with us and discover how purpose-driven strategy can transform your business from the ground up."), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => navigate("/contact"),
      className: "inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-secondary text-on-secondary text-base font-bold hover:opacity-90 transition-all active:scale-[0.98] shadow-lg shadow-black/10"
    },
    "Start the Conversation",
    /* @__PURE__ */ React.createElement(Icons.ArrowRight, { className: "w-5 h-5" })
  ))));
}
var FeaturesContent_default = FeaturesContent;
export {
  FeaturesContent_default as default
};
