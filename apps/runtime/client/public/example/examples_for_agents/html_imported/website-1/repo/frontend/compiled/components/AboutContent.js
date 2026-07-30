// repo/frontend/code/components/AboutContent.tsx
import { React, useShadowDom, cn } from "@exepad/sdk";
function AboutContent({ className }) {
  const shadowRef = useShadowDom(HTML);
  return /* @__PURE__ */ React.createElement("div", { ref: shadowRef, className: cn("w-full pt-24", className) });
}
var HTML = `
<!-- Hero Section: The Story -->
<section class="relative px-8 py-20 lg:py-32 overflow-hidden">
<div class="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
<div class="z-10">
<span class="inline-block px-4 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold uppercase tracking-widest mb-6">Our Roots</span>
<h1 class="text-5xl lg:text-7xl font-black leading-tight mb-8 text-on-surface">Born from the <span class="text-primary italic">Earth</span>, Driven by Heart.</h1>
<p class="text-xl text-on-surface-variant leading-relaxed mb-10 max-w-xl">
                        HappyDoods Farm began with a simple belief: that poultry farming should be a partnership with nature, not a factory process. We traded city lights for sunrise over the meadows to bring you eggs and meat that truly taste like home.
                    </p>
<div class="flex flex-wrap gap-4">
<button class="bg-primary text-on-primary px-8 py-4 rounded-full font-bold shadow-lg hover:opacity-90 transition-all">Read Our Journey</button>
<button class="border-2 border-outline-variant text-on-surface px-8 py-4 rounded-full font-bold hover:bg-surface-container-low transition-all">View the Farm</button>
</div>
</div>
<div class="relative">
<div class="aspect-[4/5] rounded-xl overflow-hidden shadow-2xl rotate-3 transform translate-x-4">
<img alt="Farmer in a sunlit field" class="w-full h-full object-cover" data-alt="Golden sunrise over a lush green poultry farm field" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDWiTrIvrlejX1z1Stt4aB5WtADnT2n5rAVRECMdipGyCC6AXpoeXPDJ0aOKD-AWVzRaS3lXOt7yj0nHvrNM35QPLz9V7ighwZtBIjnQbqzMzSDYItAV70WtG7dRLyvTV6CD6ZU7ljd_RKXAXCL1HJw11LaBtwY1SrEkMWLqL7pJBFK0UlSSolSvGlGWrfsAvNf2IOI7GYTf24KqSAAk5Zo19-SKmJMbzPxlqmxMDYT40kVl6WWVwpcSuxNi9JbhoHyfJQPbmX6M8Q"/>
</div>
<div class="absolute -bottom-10 -left-10 w-64 h-64 rounded-xl overflow-hidden shadow-xl -rotate-6 hidden md:block">
<img alt="Happy chickens" class="w-full h-full object-cover" data-alt="Close up of healthy heritage chickens grazing in grass" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB1PtJTkqvfIvzFSVbZUg5l_ktmwWRGAEICT0msUk2sAMNl2By8X0BMP5Uf160d1JiUzcPemCKa2be7WNbyPWWJeyFLnEoBm5kwjmRrfyD9yE0FAZq0yE3hmtSeTfTutQ_Bf2ZdqHZvol0CuS0TxvRTYr_nJSjaCEi_nVXH4ALC6mkptXTpnOd-D3TuvVwkk5pNIu5bkKRj91Gnj97ikmo0F1yH5IxDse_q8jiWkrauIGjpyxXWzh6OPZS9fWCjWGA4tB7kG0DNz2U"/>
</div>
</div>
</div>
</section>
<!-- Our Philosophy: Color Blocking instead of Borders -->
<section class="bg-surface-container-low py-24 px-8">
<div class="max-w-7xl mx-auto">
<div class="text-center mb-16">
<h2 class="text-4xl lg:text-5xl font-black text-secondary mb-4">Our Philosophy</h2>
<div class="h-1 w-24 bg-primary mx-auto rounded-full"></div>
</div>
<div class="grid grid-cols-1 md:grid-cols-3 gap-8">
<div class="bg-surface-container-lowest p-10 rounded-lg shadow-sm">
<span class="material-symbols-outlined text-4xl text-primary mb-6" data-icon="nature">nature</span>
<h3 class="text-2xl font-bold mb-4">Ethical Harmony</h3>
<p class="text-on-surface-variant leading-relaxed">We believe every animal deserves a life under the sun. Our ethical standards exceed organic requirements, ensuring space to roam and natural behaviors.</p>
</div>
<div class="bg-surface-container-lowest p-10 rounded-lg shadow-sm">
<span class="material-symbols-outlined text-4xl text-primary mb-6" data-icon="energy_savings_leaf">energy_savings_leaf</span>
<h3 class="text-2xl font-bold mb-4">Soil Regeneration</h3>
<p class="text-on-surface-variant leading-relaxed">Our chickens are our partners in land management. Their natural movement helps sequester carbon and naturally fertilizes our pastures.</p>
</div>
<div class="bg-surface-container-lowest p-10 rounded-lg shadow-sm">
<span class="material-symbols-outlined text-4xl text-primary mb-6" data-icon="restaurant">restaurant</span>
<h3 class="text-2xl font-bold mb-4">Nutritional Integrity</h3>
<p class="text-on-surface-variant leading-relaxed">Nature produces the best nutrients. By following a seasonal cycle and natural diet, we deliver products that are demonstrably higher in Vitamin D and Omega-3s.</p>
</div>
</div>
</div>
</section>
<!-- Why Our Chickens are Happy: Bento Style Layout -->
<section class="py-24 px-8 max-w-7xl mx-auto">
<h2 class="text-4xl lg:text-5xl font-black text-center mb-16">Why Our Chickens are <span class="italic text-primary">Happy</span></h2>
<div class="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-6 h-auto md:h-[700px]">
<div class="md:col-span-2 md:row-span-2 bg-secondary-container rounded-xl overflow-hidden relative group">
<img alt="Free range meadow" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" data-alt="Chickens wandering freely in a vast sun-drenched meadow" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB_2vfnYk703bS-1NGWJzOSbo_KK42pEOt-fiNUBpzTwgNVO63BJcynsz3vNo5s11QlgByO_5r8g02HapaczsrVSwAG1N60_HpqtunY8CzxyDocS5l3M8RaERLtNsl_HmVxSYCFVKPDFfFjfAIbSjKgR2ZqHGiO1NYE-VWfbrb8vDsVlBNVKZwI24yNO1YkC3f-WBY9o4kZV9BpSQhqwY6JYBC418eewwI9TEBmkxJo2f0GlQ2BnFOgZcy3yCv_H6imTmBuUrVnnoA"/>
<div class="absolute inset-0 bg-gradient-to-t from-secondary/80 to-transparent p-8 flex flex-col justify-end">
<h3 class="text-3xl font-bold text-white mb-2">Unlimited Pasture Access</h3>
<p class="text-white/90">24/7 access to fresh grass, bugs, and sunshine.</p>
</div>
</div>
<div class="md:col-span-2 bg-surface-container p-8 rounded-xl flex flex-col justify-center">
<div class="flex items-center gap-4 mb-4">
<span class="material-symbols-outlined text-primary text-3xl" data-icon="eco">eco</span>
<h3 class="text-xl font-bold">GMO-Free Supplemental Feed</h3>
</div>
<p class="text-on-surface-variant">Beyond what they forage, we provide a custom blend of organic grains designed for avian health, not just rapid growth.</p>
</div>
<div class="md:col-span-1 bg-tertiary-container rounded-xl p-6 flex flex-col justify-center text-center">
<div class="bg-white/20 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-4">
<span class="material-symbols-outlined text-on-tertiary-container" data-icon="favorite" data-weight="fill" style="font-variation-settings: 'FILL' 1;">favorite</span>
</div>
<h4 class="font-bold text-on-tertiary-container">Stress-Free Environment</h4>
</div>
<div class="md:col-span-1 bg-surface-container-high rounded-xl p-6 flex flex-col justify-center text-center">
<div class="bg-primary/20 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-4">
<span class="material-symbols-outlined text-primary" data-icon="diversity_3">diversity_3</span>
</div>
<h4 class="font-bold">Social Flock Living</h4>
</div>
</div>
</section>
<!-- Meet the Team: Organic Editorial Cards -->
<section class="bg-surface py-24 px-8">
<div class="max-w-7xl mx-auto">
<div class="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8">
<div class="max-w-2xl">
<h2 class="text-4xl lg:text-5xl font-black mb-6">The People Behind the Scenes</h2>
<p class="text-xl text-on-surface-variant leading-relaxed italic">"We don't just work on a farm; we live a philosophy. Every day is an opportunity to honor the land and the life it sustains."</p>
</div>
<button class="bg-secondary text-on-secondary px-8 py-4 rounded-full font-bold hover:bg-on-secondary-fixed-variant transition-colors flex items-center gap-2">
                        Join Our Team <span class="material-symbols-outlined" data-icon="arrow_forward">arrow_forward</span>
</button>
</div>
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
<!-- Team Member 1 -->
<div class="flex flex-col">
<div class="aspect-square rounded-full overflow-hidden mb-6 border-8 border-surface-container-low shadow-inner">
<img alt="Farmer John" class="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500" data-alt="Portrait of a friendly middle-aged farmer in a straw hat" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC9qc89iVxcTewO2oc_mykYkdfIdkil223xrVVhezU7Llp7431ngPUm20jbzfPbhu2NhjQPmIbGPwEp1Hrd4qj9gpOUe9bGi7ZtfpACxEaVY8Q_yh_mA73h2kkkJfbB7O75Qe0HkHA101pIhc5glhbw_au4OT-sfrq0Vo5FhA8sbQEu1tzwZ_ySM2kb29N6E2gAqjV9YT5OXeECD8ZOInFA4fi5dwDqivpI0-AgSKjsYf0r2FNDS512bYZJcR8ehlxnjpQ832pZtS4"/>
</div>
<h4 class="text-2xl font-bold">John Harrison</h4>
<span class="text-tertiary font-bold uppercase tracking-widest text-xs mb-3">Founder &amp; Head Shepard</span>
<p class="text-on-surface-variant text-sm">3rd generation farmer dedicated to bringing back heritage poultry breeds.</p>
</div>
<!-- Team Member 2 -->
<div class="flex flex-col mt-8 lg:mt-0">
<div class="aspect-square rounded-full overflow-hidden mb-6 border-8 border-surface-container-low shadow-inner">
<img alt="Farmer Elena" class="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500" data-alt="Portrait of a smiling young woman on a farm with a notebook" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDoE1-67XUXIdWOTp0gvQjyL-wcICud5P5QD_zy-d7JgpoUwOqyAKGRvx7mpu8b_O61u0t20bmNIlWuUcfeDwG3RuIAc_S2ezjeLh3bTqOmR6Y-DR-uj4liIBbHx3z31twZoWvaLX25v9aWpUF_KOvPZeLwMQJ8vqnO4dvvfMueUwzmOh2705CYsg1-4CmPsF5Xx8cP5547Z9IqQ4GvQHcJ2OwvonF3r2GTrlctu0DlZnMvSg8AMuYfuFoWB3CtCfzaX8jrsBY5viY"/>
</div>
<h4 class="text-2xl font-bold">Elena Ruiz</h4>
<span class="text-tertiary font-bold uppercase tracking-widest text-xs mb-3">Animal Welfare Director</span>
<p class="text-on-surface-variant text-sm">Former veterinarian focusing on holistic health and stress-free living systems.</p>
</div>
<!-- Team Member 3 -->
<div class="flex flex-col">
<div class="aspect-square rounded-full overflow-hidden mb-6 border-8 border-surface-container-low shadow-inner">
<img alt="Marcus" class="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500" data-alt="Young man in denim shirt standing in a vegetable garden" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCZehm83-51f0KfyTnxlG0GR3N9mfAH_Hh8HfPNeKmJQYtkNTX5rc2fKxaMG_i21GDtyMdr4ZCQfaDtQ-qeyqi08k_YbieKyq3XCT8imldGkRX2yRmKfGAnJL2grg7gaPoACrpwgufqDXrCxB1UeMG4lp1WERHLZE6EmKb0DZcOcWgH7WJxAiA7b-5s6MPQZCTzpqwkvsNRotM0Q6leFVoIcCJLHkYi6ICzIfd_dR_SU7VDLTW_7_IpxPKn2O64HSjelVmR3Kel_YA"/>
</div>
<h4 class="text-2xl font-bold">Marcus Thorne</h4>
<span class="text-tertiary font-bold uppercase tracking-widest text-xs mb-3">Regenerative Lead</span>
<p class="text-on-surface-variant text-sm">Specialist in soil biodiversity and carbon-negative grazing rotations.</p>
</div>
<!-- Team Member 4 -->
<div class="flex flex-col mt-8 lg:mt-0">
<div class="aspect-square rounded-full overflow-hidden mb-6 border-8 border-surface-container-low shadow-inner">
<img alt="Sarah" class="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500" data-alt="Portrait of a professional woman with a welcoming smile" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCZsXDpPzhdY5oxpOGkrScRf1bJm3APeIUy-3q-ZD-1ADvSFlRrnpJ_qWKYNB47Gs5Xe-DRqE18pV4ebMWPDLuXIK6bULInYZMfDzQMuxGJHWAEKxSFGwic_zNyFey1UCydZV9uKSI9V8PyeRRzxywUrIPUfMXma4F0bA4g_YjhYG4JTxZ9HplcdNzF8Pg8g_Kbyc70Rbh2IT5CzjqRqoapH13J1P1uDgbd_8kyxzPTS6i-tbAqQRzEdg-DUf-ppLHBZF62ov0cscY"/>
</div>
<h4 class="text-2xl font-bold">Sarah Chen</h4>
<span class="text-tertiary font-bold uppercase tracking-widest text-xs mb-3">Community &amp; Sales</span>
<p class="text-on-surface-variant text-sm">Passionate about connecting local families with nutrient-dense food sources.</p>
</div>
</div>
</div>
</section>
<!-- Final CTA Section -->
<section class="px-8 pb-20">
<div class="max-w-7xl mx-auto rounded-xl overflow-hidden relative">
<div class="absolute inset-0 z-0">
<img alt="Wide farm landscape" class="w-full h-full object-cover" data-alt="Wide panoramic shot of a golden wheat field and farmhouse" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCvH9Kd4-r-HKAflOeTki1c_-jO4ENTFyK5QYgin-zkAAYDzeAhfcCh4KIyU_vWC7_AeLpNlBLdkZ2a3zfUcs7QEspujR7G5jKhgh5rcjVXgvLWZLxGJ6dfnnIyAUOu7uSHBBNIaKRR4zrULCR9cXopohY6lOxTYfsEEm8H6ulbryWNe-kPC3CteUsZ6riFLCeDHP537Yf3M0f8BPQGF6NoRn4h5vQgp8hmWsxsAeISXurmVzNcgTNeWMcHE5q8gyqAlE4Gd_wEtaA"/>
<div class="absolute inset-0 bg-primary/40 backdrop-blur-[2px]"></div>
</div>
<div class="relative z-10 py-24 px-8 text-center text-white">
<h2 class="text-4xl lg:text-6xl font-black mb-8">Taste the Difference of Care.</h2>
<p class="text-xl max-w-2xl mx-auto mb-12 text-white/90">Join our subscription boxes and have the freshest farm-to-table eggs delivered to your doorstep weekly.</p>
<button class="bg-white text-primary px-10 py-5 rounded-full font-black text-xl hover:bg-surface-container-lowest transition-all shadow-xl">Start Your Harvest</button>
</div>
</div>
</section>
`;
export {
  AboutContent as default
};
