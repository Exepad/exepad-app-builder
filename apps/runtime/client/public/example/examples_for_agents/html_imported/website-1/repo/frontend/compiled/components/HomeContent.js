// repo/frontend/code/components/HomeContent.tsx
import { React, useShadowDom, cn } from "@exepad/sdk";
function HomeContent({ className }) {
  const shadowRef = useShadowDom(HTML);
  return /* @__PURE__ */ React.createElement("div", { ref: shadowRef, className: cn("w-full", className) });
}
var HTML = `
<!-- Hero Section -->
<section class="relative h-[921px] flex items-center overflow-hidden">
<div class="absolute inset-0 z-0">
<img alt="Happy chickens grazing in a lush green pasture at sunrise" class="w-full h-full object-cover" data-alt="Happy chickens grazing in a lush green pasture at sunrise" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD2GcsmEfpqNzwiL07EYC_OSTuVFoqSUSZeR9VG5r3h9l5yGAiGse9Ad2MSk0Ckhxyj0SyavhKRMvqVN0NfUFtp8WbPyfp96VdAHmVEfcvNd1K197W5lHZOCJ2KBJoaCL5jrSkM8eFt8B7U-VRHIoXkkxS4b-H8Ad7sxy0OhpQfnnZeDbcdMd1n-gD_06iJ96Jb6fEhnCc2X6LvKf7hXAd3MpVoUM85dFHFR27MRngMCm9skoo1vzzMNH6XXtAnoCsvawb5bkPax9c"/>
<div class="absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent"></div>
</div>
<div class="relative z-10 max-w-7xl mx-auto px-8 w-full">
<div class="max-w-2xl">
<span class="inline-block py-2 px-4 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded-full text-xs font-bold tracking-widest uppercase mb-6">
                        Pasture Raised \u2022 Organic \u2022 Local
                    </span>
<h1 class="text-6xl md:text-8xl font-bold leading-[1.1] text-on-surface mb-8">
                        The Soul of the <br/><span class="text-primary italic">Homestead.</span>
</h1>
<p class="text-xl text-on-surface-variant leading-relaxed mb-10 max-w-lg">
                        We believe happy chickens make better food. Our birds roam free on 40 acres of pesticide-free pasture, under the warm sunshine and blue skies.
                    </p>
<div class="flex flex-col sm:flex-row gap-4">
<button class="bg-primary text-on-primary px-10 py-5 rounded-full font-bold text-lg hover:opacity-90 transition-all flex items-center justify-center gap-2">
                            Shop The Harvest
                            <span class="material-symbols-outlined">arrow_forward</span>
</button>
<button class="bg-surface-container-highest text-on-surface px-10 py-5 rounded-full font-bold text-lg hover:bg-surface-variant transition-all">
                            Our Method
                        </button>
</div>
</div>
</div>
</section>
<!-- Our Story Teaser - Bento Style -->
<section class="py-24 bg-surface">
<div class="max-w-7xl mx-auto px-8">
<div class="grid grid-cols-1 md:grid-cols-12 gap-8">
<div class="md:col-span-7 bg-surface-container-low p-12 rounded-xl flex flex-col justify-center">
<h2 class="text-4xl md:text-5xl font-bold mb-6 text-secondary">Our Story</h2>
<p class="text-lg text-on-surface-variant leading-relaxed mb-8">
                            HappyDoods started with just six hens and a dream of cleaner, more ethical food. Today, we're a leading organic farm, but our philosophy hasn't changed. We treat every bird with respect, and the land with reverence.
                        </p>
<div class="flex items-center gap-6">
<div class="flex -space-x-3">
<img alt="Farmer" class="w-12 h-12 rounded-full border-4 border-surface" data-alt="Portrait of farmer Jack" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAiVGewfWaAQ_ckZ0HSCrh9fZkyeVUGhH1973XVl3IZ72Izw4q_-87f3SdURSKkNTPdkT3_fSFMpBkhkt6xiIebi70ZlQ0YcGZ9m_mzxqcnwTHlLADGoOED2hbYY3QSI7A8H4B11ZsxqFPJQLG7WsXESxUj1n4X0uNhXi7WDBYY96Bjdh_UTb2pfW1QpmYWabaor7FDqm7YLK9n_uMAU2MYiQXnNu7oi4_YrP9Bgp5uSKGHH6AQunW-8XU7s9MijMwK1-Csl9mDVAw"/>
<img alt="Farmer" class="w-12 h-12 rounded-full border-4 border-surface" data-alt="Portrait of farmer Sarah" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCMjv9OAx8_jJ44nvNG0tk_hhmz0qw-9eSYX8zbcL9U3BrEVzcDQSpkBPKRYBibN9pzL7zhTu8Kuaa6ua3tI98jd3Lwenp7lr6GF9tfZ6ArdBxbm6Zv1u8TRqRVciooQjxY2pAsXTP2Bojgg72MMHoC4Mffcxr6Ht5xFtTo6jMBpo-ENAmpqicvbNvTLoh1LdUx2l9rCYRLVNfHtNfM04008lsJEzMk-N7rSehcXOyNZiYIEf_AmNz7Wkfko4xmRuqDSGv08P4OMF4"/>
</div>
<span class="text-sm font-bold text-outline uppercase tracking-wider">Founded by Jack &amp; Sarah, 2012</span>
</div>
</div>
<div class="md:col-span-5 relative h-80 md:h-auto rounded-xl overflow-hidden group">
<img alt="The Farmhouse" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" data-alt="Wide shot of the HappyDoods farmhouse at dawn" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC2dDydtrh08XqIBYGO183F4_v-cdZjen1BTuqR06gMyvq_tfVX0qTIKmHChG9E2VOJwdGq0P4Y3ge1hYW3WYLw-_aRahzMbXv369SCz1-_-jKNq5b_A_BVatJ2iUCc1U6I5H95tiqhvL7q6MHun6JVtNI7UIrZ2557LbnBDbqzJiE5lkFYP1OOQNDOUioTNd3fkEH11nC23B6MD2FgRAUQ1erJ5RNAMwPQNHlgmEplEhaDBh0sp39uy2rLmqAuEymkCLw8cNmixeY"/>
<div class="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
<div class="absolute bottom-6 left-6 text-white">
<span class="material-symbols-outlined text-4xl mb-2">potted_plant</span>
<p class="font-serif italic text-lg">Rooted in Nature.</p>
</div>
</div>
</div>
</div>
</section>
<!-- Latest Products Section -->
<section class="py-24 bg-surface-container-low">
<div class="max-w-7xl mx-auto px-8">
<div class="flex justify-between items-end mb-16">
<div>
<h2 class="text-4xl md:text-5xl font-bold text-on-surface mb-4">Latest Products</h2>
<p class="text-secondary font-medium uppercase tracking-widest text-sm">Straight from the coop to your kitchen</p>
</div>
<a class="hidden md:flex items-center gap-2 text-primary font-bold hover:underline" href="#">
                        View Full Catalog
                        <span class="material-symbols-outlined">chevron_right</span>
</a>
</div>
<div class="grid grid-cols-1 md:grid-cols-2 gap-10">
<!-- Product Card: Eggs -->
<div class="group cursor-pointer">
<div class="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface-container-lowest mb-6">
<img alt="Fresh Eggs" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" data-alt="A basket of multi-colored farm fresh eggs" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAMheo4hXPFfh3hoNpS4-rTeym5ekxg2cEhvLLDwqfSyTGzKEmTRK94cd8-V8feaWZ4XtVLNqB0OibTZyvLPWyRsLrXolElvTw1iATaRtGrxmC4t-7d_WHd7gOmzBekk6zc9GqB6WDqyHWvFZ4BnIfwv6mTHv1cWI6jA0OWPQ2SaZBNWv3qtrVvzF0IYP_uZojvRuxSmCjXy0G3rmE3B0NZBoa1jEcsXY07HxUlkAZXuCvRLXa9xXkUXqAm2uOXPWb1SOU6zsMIg-w"/>
<span class="absolute top-4 right-4 bg-tertiary-fixed text-on-tertiary-fixed-variant px-4 py-1 rounded-full text-xs font-bold uppercase">Harvest Badge</span>
</div>
<div class="flex justify-between items-start">
<div>
<h3 class="text-2xl font-bold mb-2">Pasture-Raised Heirloom Eggs</h3>
<p class="text-on-surface-variant max-w-sm">Deep orange yolks and rich flavor. Available in dozen and half-dozen cartons.</p>
</div>
<span class="text-2xl font-serif text-secondary">$8.00</span>
</div>
</div>
<!-- Product Card: Poultry -->
<div class="group cursor-pointer">
<div class="relative aspect-[16/10] overflow-hidden rounded-xl bg-surface-container-lowest mb-6">
<img alt="Poultry" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" data-alt="A whole organic chicken prepared with herbs" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCpFJhyYg93UfqkxvdzCPjryav2W5EWHN7Pr4gi8b571jI2s2OyqpA19jQ1PH_zR5CMhrq7mm-vRVMtfguSM1FaIjCyhtTAkN7V8wil3i6FNpQRSk0ZYFLuZQfxPAVbBVy7qM1QttqnhlXuM9piZyDCVv0NoZQI1iJa71G0NOzGd4hm1qqkNMYatoLq4Aw_I_r3aDnHuTpRkr9fMy8sS1PpD8lVm2TJSvcJytzAxG1FUiDpangnaQ5AFCCCdy8QLpFBkI9uExirf74"/>
</div>
<div class="flex justify-between items-start">
<div>
<h3 class="text-2xl font-bold mb-2">Whole Heritage Poultry</h3>
<p class="text-on-surface-variant max-w-sm">Slow-grown for exceptional texture and taste. Pasture-raised and grain-finished.</p>
</div>
<span class="text-2xl font-serif text-secondary">$24.00</span>
</div>
</div>
</div>
</div>
</section>
<!-- Newsletter / Community Section -->
<section class="py-24 bg-secondary text-on-secondary relative overflow-hidden">
<div class="absolute top-0 right-0 opacity-10 pointer-events-none">
<span class="material-symbols-outlined text-[30rem] leading-none">egg</span>
</div>
<div class="max-w-4xl mx-auto px-8 text-center relative z-10">
<h2 class="text-4xl md:text-6xl font-serif font-bold mb-8">Join the Farmily</h2>
<p class="text-xl mb-12 opacity-90 leading-relaxed">
                    Subscribe for seasonal recipes, farm updates, and first access to our limited-batch holiday harvests.
                </p>
<form class="flex flex-col sm:flex-row gap-4 max-w-lg mx-auto">
<input class="flex-1 px-6 py-4 rounded-full bg-white/10 border border-white/20 text-white placeholder:text-white/60 focus:outline-hidden focus:ring-2 focus:ring-primary-container" placeholder="Your email address" type="email"/>
<button class="bg-primary-container text-on-primary-container px-8 py-4 rounded-full font-bold hover:brightness-110 transition-all">
                        Subscribe
                    </button>
</form>
</div>
</section>
`;
export {
  HomeContent as default
};
