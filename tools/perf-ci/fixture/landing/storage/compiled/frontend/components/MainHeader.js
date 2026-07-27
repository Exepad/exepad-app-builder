// ../../../../../tmp/exepad-build-a1kguu163-qr2bL9/MainHeader.tsx
import { React, LightDOMContainer, Icons, useNavigation, navigate } from "@exepad/sdk";
var NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Services", href: "/services" },
  { label: "Features", href: "/features" },
  { label: "Testimonials", href: "/testimonials" },
  { label: "Contact", href: "/contact" }
];
function MainHeader() {
  const { currentSlug } = useNavigation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  React.useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);
  return /* @__PURE__ */ React.createElement(LightDOMContainer, null, /* @__PURE__ */ React.createElement("header", { className: "sticky top-0 z-50 w-full bg-surface/80 backdrop-blur-md border-b border-outline-variant/10" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-4 md:px-6 lg:px-10" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between h-16 md:h-20" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => navigate("/"),
      className: "flex items-center gap-2 group",
      "aria-label": "Home"
    },
    /* @__PURE__ */ React.createElement("div", { className: "w-8 h-8 rounded-lg bg-primary flex items-center justify-center" }, /* @__PURE__ */ React.createElement(Icons.Leaf, { className: "w-5 h-5 text-on-primary" })),
    /* @__PURE__ */ React.createElement("span", { className: "font-headline text-xl font-bold text-on-surface group-hover:text-primary transition-colors" }, "Verdant")
  ), /* @__PURE__ */ React.createElement("nav", { className: "hidden lg:flex items-center gap-1" }, NAV_ITEMS.map((item) => {
    const isActive = currentSlug === item.href;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: item.href,
        onClick: () => navigate(item.href),
        className: `px-4 py-2 rounded-lg text-sm font-medium transition-all ${isActive ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"}`
      },
      item.label
    );
  })), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => navigate("/contact"),
      className: "hidden lg:inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-all active:scale-[0.98]"
    },
    "Get in Touch",
    /* @__PURE__ */ React.createElement(Icons.ArrowRight, { className: "w-4 h-4" })
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "p-2 text-on-surface lg:hidden min-w-11 min-h-11 flex items-center justify-center rounded-lg hover:bg-surface-container-low transition-colors",
      onClick: () => setIsMobileMenuOpen(!isMobileMenuOpen),
      "aria-label": isMobileMenuOpen ? "Close Menu" : "Open Menu"
    },
    isMobileMenuOpen ? /* @__PURE__ */ React.createElement(Icons.X, { className: "w-6 h-6" }) : /* @__PURE__ */ React.createElement(Icons.Menu, { className: "w-6 h-6" })
  )))), isMobileMenuOpen && /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-[60] bg-surface flex flex-col lg:hidden" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-end p-4" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "p-2 text-on-surface min-w-11 min-h-11 flex items-center justify-center rounded-lg hover:bg-surface-container-low transition-colors",
      onClick: () => setIsMobileMenuOpen(false),
      "aria-label": "Close Menu"
    },
    /* @__PURE__ */ React.createElement(Icons.X, { className: "w-6 h-6" })
  )), /* @__PURE__ */ React.createElement("nav", { className: "flex flex-col items-center justify-center flex-1 gap-6 px-6" }, NAV_ITEMS.map((item) => {
    const isActive = currentSlug === item.href;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: item.href,
        onClick: () => {
          setIsMobileMenuOpen(false);
          navigate(item.href);
        },
        className: `text-2xl font-bold transition-colors ${isActive ? "text-primary" : "text-on-surface hover:text-primary"}`
      },
      item.label
    );
  }), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setIsMobileMenuOpen(false);
        navigate("/contact");
      },
      className: "mt-6 w-full max-w-xs px-8 py-4 rounded-xl bg-primary text-on-primary text-lg font-semibold hover:opacity-90 transition-all active:scale-[0.98]"
    },
    "Get in Touch"
  ))));
}
var MainHeader_default = MainHeader;
export {
  MainHeader_default as default
};
