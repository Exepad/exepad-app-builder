// repo/frontend/code/components/HappyDoodsFooter.tsx
import { React, useShadowDom, cn } from "@exepad/sdk";
function HappyDoodsFooter({ className }) {
  const shadowRef = useShadowDom(HTML);
  return /* @__PURE__ */ React.createElement("div", { ref: shadowRef, className: cn("w-full", className) });
}
var HTML = `
<footer class="bg-[#ebe8e2] dark:bg-[#1c1c18] w-full py-12 mt-20">
<div class="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-7xl mx-auto px-10">
<div>
<div class="text-xl font-serif font-bold text-[#47664b] dark:text-[#f4b400] mb-6">HappyDoods</div>
<p class="text-[#47664b] opacity-70 mb-6 font-sans text-sm uppercase tracking-widest leading-loose">
HappyDoods Farm<br/>
123 Pasture Lane<br/>
Green Valley, OR 97401
</p>
<div class="flex gap-4">
<span class="material-symbols-outlined text-[#47664b]">potted_plant</span>
<span class="material-symbols-outlined text-[#47664b]">egg</span>
<span class="material-symbols-outlined text-[#47664b]">grass</span>
</div>
</div>
<div class="flex flex-col gap-4 font-sans text-sm uppercase tracking-widest">
<a class="text-[#47664b] opacity-70 hover:text-[#a03f29] transition-colors duration-200" href="#">Privacy Policy</a>
<a class="text-[#47664b] opacity-70 hover:text-[#a03f29] transition-colors duration-200" href="#">Terms of Service</a>
<a class="text-[#47664b] opacity-70 hover:text-[#a03f29] transition-colors duration-200" href="#">Wholesale Inquiries</a>
<a class="text-[#47664b] opacity-70 hover:text-[#a03f29] transition-colors duration-200" href="#">Visit the Farm</a>
</div>
<div class="flex flex-col justify-between">
<div>
<h4 class="font-serif font-bold text-[#47664b] mb-4">Hours</h4>
<p class="text-[#47664b] opacity-70 font-sans text-sm tracking-widest">MON - SAT: 8AM - 6PM</p>
<p class="text-[#47664b] opacity-70 font-sans text-sm tracking-widest">SUN: 10AM - 4PM</p>
</div>
<div class="mt-8 md:mt-0">
<p class="text-[#47664b] dark:text-[#f4b400] font-sans text-xs uppercase tracking-widest">
\xA9 2024 HappyDoods Farm. Rooted in Nature.
</p>
</div>
</div>
</div>
</footer>
`;
export {
  HappyDoodsFooter as default
};
