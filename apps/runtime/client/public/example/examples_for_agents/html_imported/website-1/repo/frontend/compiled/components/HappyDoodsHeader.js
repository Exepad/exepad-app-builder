// repo/frontend/code/components/HappyDoodsHeader.tsx
import { React, navigate, useShadowDom, cn } from "@exepad/sdk";
var { useMemo } = React;
function HappyDoodsHeader({ className }) {
  const html = useMemo(() => {
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    const slug = path.replace(/^\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+/, "") || "/";
    const links = [
      { label: "Home", href: "/" },
      { label: "Products", href: "/products" },
      { label: "About Us", href: "/about" },
      { label: "Contact", href: "/contact" }
    ];
    const navHtml = links.map((l) => {
      const active = slug === l.href;
      const cls = active ? "text-[#7a5900] dark:text-[#f4b400] font-bold border-b-2 border-[#7a5900] dark:border-[#f4b400] pb-1 transition-transform scale-95 active:scale-100" : "text-[#47664b] dark:text-[#ebe8e2] hover:text-[#7a5900] transition-colors hover:opacity-80";
      return `<a class="${cls} font-serif text-lg tracking-tight" href="${l.href}">${l.label}</a>`;
    }).join("\n");
    return `
      <div class="flex justify-between items-center max-w-7xl mx-auto px-8 py-4">
        <div class="text-2xl font-black text-[#7a5900] dark:text-[#f4b400] font-serif">HappyDoods</div>
        <div class="hidden md:flex items-center space-x-10 font-serif text-lg tracking-tight">
          ${navHtml}
        </div>
        <button class="bg-primary text-on-primary px-8 py-3 rounded-full font-bold hover:opacity-80 transition-opacity duration-300 scale-95 active:scale-100">
          Order Now
        </button>
      </div>
    `;
  }, []);
  const shadowRef = useShadowDom(html);
  React.useEffect(() => {
    const root = shadowRef.current?.shadowRoot;
    if (!root) return;
    const handleClick = (e) => {
      const link = e.target.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href && href.startsWith("/")) {
        e.preventDefault();
        navigate(href);
      }
    };
    root.addEventListener("click", handleClick);
    return () => root.removeEventListener("click", handleClick);
  }, []);
  return /* @__PURE__ */ React.createElement("div", { ref: shadowRef, className: cn("w-full bg-[#fcf9f3]/80 backdrop-blur-md shadow-sm", className) });
}
export {
  HappyDoodsHeader as default
};
