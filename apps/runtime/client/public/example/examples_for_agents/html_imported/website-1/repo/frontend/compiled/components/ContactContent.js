// repo/frontend/code/components/ContactContent.tsx
import { React, useShadowDom, cn } from "@exepad/sdk";
function ContactContent({ className }) {
  const shadowRef = useShadowDom(HTML);
  return /* @__PURE__ */ React.createElement("div", { ref: shadowRef, className: cn("w-full pt-32 pb-20", className) });
}
var HTML = `
<!-- Hero Section -->
<section class="max-w-7xl mx-auto px-8 mb-24">
<div class="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
<div class="space-y-6">
<span class="inline-block px-4 py-1 bg-tertiary-fixed text-on-tertiary-fixed-variant rounded-full text-xs font-bold tracking-widest uppercase">Get In Touch</span>
<h1 class="text-6xl font-black text-on-surface leading-tight">We'd love to hear from <span class="text-primary italic">you</span>.</h1>
<p class="text-xl text-on-surface-variant max-w-lg leading-relaxed">
                        Whether you have a question about our harvest, our happy doodles, or just want to talk about farm life, our gates are always open.
                    </p>
</div>
<div class="relative">
<div class="aspect-[4/5] rounded-xl overflow-hidden shadow-2xl rotate-2">
<img alt="Aerial view of a lush green farm" class="w-full h-full object-cover" data-alt="Scenic sun-drenched organic farm landscape" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCrQ8DFDeYsmKc99ej_grOZgt_XiB2So_LM7kjrBJpBU48wZyU4gwdLrosXvKvafma2E_xkDIleF5qFCGvBFhSMbRYqhJJzhN04XAFp-PdzMFPOaT5i0LEqTDyDqSr8gGmvHkZ2kJ7FiuRKNZOqCMA3vCS5s8stQsWKs5stwIPwUrjmoE1ijs7uIWP00okWH6Xr1PzHdUBvs_3mouTVeb4WEvffllipuUwOu5wLIx-C76uR0C1Xaj3V1-MmupoOhd8oNw_3b1djVGc"/>
</div>
<!-- Harvest Badge -->
<div class="absolute -bottom-6 -left-6 bg-tertiary text-on-tertiary p-8 rounded-full shadow-xl">
<div class="text-center">
<span class="block font-serif text-2xl font-bold">100%</span>
<span class="text-xs uppercase tracking-tighter">Organic</span>
</div>
</div>
</div>
</div>
</section>
<!-- Main Content Area: Bento-ish Grid -->
<section class="max-w-7xl mx-auto px-8">
<div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
<!-- Inquiry Form (The Glass Card) -->
<div class="lg:col-span-7 bg-surface-container-lowest rounded-xl p-10 shadow-sm border border-outline-variant/10">
<h2 class="text-3xl font-bold mb-8 font-serif">Send a Message</h2>
<form action="#" class="space-y-6">
<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
<div class="space-y-2">
<label class="text-sm font-bold text-secondary uppercase tracking-wider" for="name">Full Name</label>
<input class="w-full bg-surface-container-low border-none rounded-xl py-4 px-6 focus:ring-2 focus:ring-primary placeholder:text-outline-variant/60 transition-all" id="name" name="name" placeholder="John Doe" type="text"/>
</div>
<div class="space-y-2">
<label class="text-sm font-bold text-secondary uppercase tracking-wider" for="email">Email Address</label>
<input class="w-full bg-surface-container-low border-none rounded-xl py-4 px-6 focus:ring-2 focus:ring-primary placeholder:text-outline-variant/60 transition-all" id="email" name="email" placeholder="john@example.com" type="email"/>
</div>
</div>
<div class="space-y-2">
<label class="text-sm font-bold text-secondary uppercase tracking-wider" for="message">Your Message</label>
<textarea class="w-full bg-surface-container-low border-none rounded-xl py-4 px-6 focus:ring-2 focus:ring-primary placeholder:text-outline-variant/60 transition-all" id="message" name="message" placeholder="Tell us what's on your mind..." rows="5"></textarea>
</div>
<button class="w-full bg-primary text-on-primary py-5 rounded-full font-black text-lg shadow-lg hover:shadow-primary/20 hover:opacity-90 transition-all" type="submit">
                            Send Inquiry
                        </button>
</form>
</div>
<!-- Contact Info Column -->
<div class="lg:col-span-5 space-y-8">
<!-- Address Card -->
<div class="bg-secondary text-on-secondary rounded-xl p-8 relative overflow-hidden group">
<span class="material-symbols-outlined text-6xl absolute -bottom-4 -right-4 opacity-10 group-hover:scale-110 transition-transform" data-icon="location_on">location_on</span>
<h3 class="text-2xl font-bold mb-4 font-serif">Visit the Farm</h3>
<p class="text-secondary-container leading-relaxed mb-6">
                            1234 Heritage Lane<br/>
                            Golden Valley, CA 90210
                        </p>
<a class="inline-flex items-center text-primary-container font-bold hover:underline" href="#">
                            Get Directions
                            <span class="material-symbols-outlined ml-2 text-sm" data-icon="arrow_forward">arrow_forward</span>
</a>
</div>
<!-- Phone & Socials -->
<div class="bg-surface-container-high rounded-xl p-8 space-y-8">
<div>
<h3 class="text-sm font-bold text-secondary uppercase tracking-wider mb-4">Give us a ring</h3>
<a class="text-3xl font-black text-on-surface hover:text-primary transition-colors" href="tel:+15551234567">+1 (555) 123-4567</a>
<p class="text-on-surface-variant text-sm mt-2">Mon - Fri: 8am - 4pm PST</p>
</div>
<hr class="border-outline-variant/20"/>
<div>
<h3 class="text-sm font-bold text-secondary uppercase tracking-wider mb-4">Follow the Journey</h3>
<div class="flex space-x-4">
<a class="w-12 h-12 rounded-full bg-surface-container-lowest flex items-center justify-center text-secondary hover:bg-primary hover:text-on-primary transition-all" href="#">
<span class="material-symbols-outlined" data-icon="photo_camera">photo_camera</span>
</a>
<a class="w-12 h-12 rounded-full bg-surface-container-lowest flex items-center justify-center text-secondary hover:bg-primary hover:text-on-primary transition-all" href="#">
<span class="material-symbols-outlined" data-icon="facebook">social_leaderboard</span>
</a>
<a class="w-12 h-12 rounded-full bg-surface-container-lowest flex items-center justify-center text-secondary hover:bg-primary hover:text-on-primary transition-all" href="#">
<span class="material-symbols-outlined" data-icon="brand_awareness">brand_awareness</span>
</a>
</div>
</div>
</div>
</div>
</div>
</section>
<!-- Map Placeholder Section -->
<section class="max-w-7xl mx-auto px-8 mt-24">
<div class="h-[400px] rounded-xl overflow-hidden relative shadow-inner">
<img alt="Topographic style map" class="w-full h-full object-cover grayscale opacity-40" data-alt="Stylized map showing farm location in California" data-location="Golden Valley, California" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB5DwfP4qzQdplfEMc7okeHiHbvuFThEBrHaQ9y6iSwnToXlAT18S2malvmazVAtyqRdeL7JSPZ3Zkz8lxTOt6bLBiXDTBeJl1CBm3W8N2T_R7MgthXWnqUm4iaBJjMxyFAOxdNHF8mRsw3ALpr8uBG8W2tfN6YfTiaRJ-hpIKU7TKQKp7ciS9U0-EqZNmPVl4DQBX653NbMeFKE0vqSxm_ZUJVhEW3YIxiuRTQXtZiJpi1J1adP1AnMA_zXNY4E9SVV__KKamaTLE"/>
<div class="absolute inset-0 flex items-center justify-center">
<div class="bg-primary-container p-4 rounded-full shadow-2xl animate-bounce">
<span class="material-symbols-outlined text-on-primary-container text-4xl" data-icon="location_on" style="font-variation-settings: 'FILL' 1;">location_on</span>
</div>
</div>
<div class="absolute bottom-6 left-6 bg-surface/90 backdrop-blur p-4 rounded-lg shadow-sm border border-outline-variant/20 max-w-xs">
<p class="font-bold text-secondary text-sm">Our Physical Roots</p>
<p class="text-xs text-on-surface-variant">Located in the heart of the valley, just 2 miles east of the historic windmill.</p>
</div>
</div>
</section>
`;
export {
  ContactContent as default
};
