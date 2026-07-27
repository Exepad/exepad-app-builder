import { React, LightDOMContainer } from '@exepad/sdk';

export default function ProductsContent({ className }) {
  return (
    <LightDOMContainer className={className}>
      <div className="w-full pt-32 pb-20 px-6 max-w-7xl mx-auto">
        {/* Hero Header */}
        <header className="mb-20">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div className="max-w-2xl">
              <span className="text-secondary font-bold tracking-widest uppercase text-sm mb-4 block">Sustainable Agriculture</span>
              <h1 className="text-5xl md:text-7xl font-black text-on-surface leading-tight">Harvested with heart, <br /><span className="text-primary italic">rooted in nature.</span></h1>
            </div>
            <div className="bg-surface-container-high p-6 rounded-lg max-w-sm">
              <p className="text-on-surface-variant leading-relaxed italic">"Our mission is to bring the purity of the pasture directly to your table, ensuring every meal is a celebration of the earth's bounty."</p>
            </div>
          </div>
        </header>

        {/* Product Grid - Bento Style */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Primary Product: Fresh Farm Eggs */}
          <div className="md:col-span-8 group overflow-hidden rounded-lg bg-surface-container-lowest transition-all hover:shadow-xl">
            <div className="grid grid-cols-1 lg:grid-cols-2">
              <div className="relative h-[400px] lg:h-full overflow-hidden">
                <img alt="Fresh Farm Eggs" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" data-alt="Brown organic farm eggs in a basket" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAZ5SQ_VX27WzMqcM0b9RhJAvj8140D9xnZu3JW-sHdXTVqSBDLgaK5GOYYLmcYDW7tRe0TP53__4IZKmL6PYmbfB_MYBverN6HSpsT3l048b6XKS_17-aBbAFHgAQEfgDk1_F6U1okE8tMpwEbpO3IgT_4kqv7S4B2EOxOpdNtDKWIbFNT1x9ApkqRCXt-aZR8jVOOE-UPPWNKeEmqb4rnl-d-mmORMO8schWdPB52_6F-qOWEj4n-hBiV3ROyDDmkdPwCFd8hEJ4" />
                <div className="absolute top-4 right-4 bg-tertiary text-on-tertiary px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase">Harvest Badge</div>
              </div>
              <div className="p-10 flex flex-col justify-center">
                <h2 className="text-4xl font-bold mb-4 text-secondary">Fresh Farm Eggs</h2>
                <p className="text-on-surface-variant text-lg leading-relaxed mb-8">
                  Gathered daily from our free-roaming, pasture-raised hens. These eggs feature vibrant orange yolks and superior flavor that only nature can provide.
                </p>
                <div className="flex items-center justify-between mt-auto">
                  <span className="text-2xl font-black text-primary">$8.00 <small className="text-sm font-normal text-on-surface-variant">/ dozen</small></span>
                  <button className="bg-secondary text-on-secondary px-8 py-3 rounded-full font-bold hover:opacity-90 transition-all scale-95 active:scale-100">Learn More</button>
                </div>
              </div>
            </div>
          </div>

          {/* Side Card: Whole Pasture-Raised Chicken */}
          <div className="md:col-span-4 group flex flex-col rounded-lg bg-surface-container-lowest transition-all hover:shadow-xl overflow-hidden">
            <div className="relative h-64 overflow-hidden">
              <img alt="Whole Chicken" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" data-alt="Roasted whole pasture raised chicken on platter" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCOKjwtvPfdcqocMgchc7QoR6w8QMsDSiwwdxYZrsCHn1ZdMF8uRuyC8PyKhbsm1mdyi-zgysJUFbps2tDq4HmCT29dVSaccCDWHO65MPXG0QL77uFDVNVmhJ3-vYpeeIkTeVxzCTxdSVKlzf8SVA9O8GIndJrs48Plvj-9cvQqTU9eJd9HidUSdRV82toU9jcx7p06XeGDBK-v_nn2KR04dE2oPKNVGpdGcNRv341AhIr8yiXMPpo4ACPZC0Mp_DiArKRHh8Q5BYU" />
            </div>
            <div className="p-8 flex-grow flex flex-col">
              <h2 className="text-2xl font-bold mb-3 text-secondary">Whole Pasture-Raised Chicken</h2>
              <p className="text-on-surface-variant mb-8 flex-grow">
                Our chickens live outdoors, foraging in fresh pastures. This natural lifestyle results in meat that is exceptionally tender, flavorful, and nutrient-dense.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-primary">$24.00 <small className="text-xs font-normal text-on-surface-variant">avg wt 4lbs</small></span>
                <button className="bg-secondary-container text-on-secondary-container px-6 py-2 rounded-full font-bold hover:opacity-90 transition-all text-sm">Learn More</button>
              </div>
            </div>
          </div>

          {/* Featured Seasonal: Seasonal Poultry */}
          <div className="md:col-span-4 group flex flex-col rounded-lg bg-surface-container-lowest transition-all hover:shadow-xl overflow-hidden">
            <div className="relative h-64 overflow-hidden">
              <img alt="Seasonal Poultry" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" data-alt="Raw poultry pieces with herbs and spices" src="https://lh3.googleusercontent.com/aida-public/AB6AXuATvGt-OCBlYw428rTI7vEq6j4ooaxWXB9HkHerun7nWgvf230-pSCguvTFE8aM0y7ffAXKzKtUB4DBF_tPNMmgmjiKT82DXHLnxIa3FEoKpR-G1hgSPSowx0oF4bbnn0Tdr06ztk4s7ld6pLevDaTHsESIei3etWTLmJl8XLvCdD1LsBTtulfcaGrHsDRJEbOULRRx0mptJQK3_E2KHu-yWdmXCWoSZ7FfP5kZzD1dcCwaoVgPfumLM2Z5AxtEKpdDqBx_KgJqFGQ" />
            </div>
            <div className="p-8 flex-grow flex flex-col">
              <h2 className="text-2xl font-bold mb-3 text-secondary">Seasonal Poultry</h2>
              <p className="text-on-surface-variant mb-8 flex-grow">
                From heritage turkeys for the holidays to spring ducklings, discover our rotating selection of specialty poultry raised with the same organic principles.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-primary">Market Price</span>
                <button className="bg-secondary-container text-on-secondary-container px-6 py-2 rounded-full font-bold hover:opacity-90 transition-all text-sm">Learn More</button>
              </div>
            </div>
          </div>

          {/* Decorative Organic Statement */}
          <div className="md:col-span-8 bg-surface-container-low rounded-lg p-12 flex items-center relative overflow-hidden">
            <div className="relative z-10 max-w-lg">
              <h3 className="text-3xl font-bold text-secondary mb-4">Beyond Organic.</h3>
              <p className="text-on-surface-variant text-lg leading-relaxed mb-6">
                We believe in regenerative farming that heals the soil, respects the animal, and nourishes the community. Every purchase supports a cycle of life that stays local.
              </p>
              <div className="flex gap-4">
                <div className="flex flex-col">
                  <span className="text-primary font-black text-2xl">100%</span>
                  <span className="text-xs uppercase tracking-widest text-outline">GMO Free</span>
                </div>
                <div className="w-px h-10 bg-outline-variant"></div>
                <div className="flex flex-col">
                  <span className="text-primary font-black text-2xl">Daily</span>
                  <span className="text-xs uppercase tracking-widest text-outline">Harvest</span>
                </div>
              </div>
            </div>
            {/* Abstract visual element */}
            <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-primary opacity-10 rounded-full blur-3xl"></div>
            <div className="absolute right-10 top-1/2 -translate-y-1/2 hidden lg:block opacity-20">
              <span className="material-symbols-outlined text-[160px] text-secondary">eco</span>
            </div>
          </div>
        </section>

        {/* Product Sub-category Row */}
        <section className="mt-20">
          <h2 className="text-3xl font-bold text-on-surface mb-10 border-l-4 border-primary pl-6">Pantry Staples</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-surface-container-lowest p-8 rounded-lg">
              <h3 className="text-xl font-bold text-secondary mb-2">Wildflower Honey</h3>
              <p className="text-sm text-on-surface-variant mb-6">Liquid gold from our on-farm apiaries. Unfiltered and raw.</p>
              <div className="flex justify-between items-center">
                <span className="font-bold text-primary">$12.00</span>
                <span className="material-symbols-outlined text-outline cursor-pointer hover:text-primary transition-colors">add_circle</span>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-8 rounded-lg">
              <h3 className="text-xl font-bold text-secondary mb-2">Heirloom Herb Bundles</h3>
              <p className="text-sm text-on-surface-variant mb-6">Fresh rosemary, thyme, and sage tied with garden twine.</p>
              <div className="flex justify-between items-center">
                <span className="font-bold text-primary">$5.50</span>
                <span className="material-symbols-outlined text-outline cursor-pointer hover:text-primary transition-colors">add_circle</span>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-8 rounded-lg">
              <h3 className="text-xl font-bold text-secondary mb-2">Compost Gold</h3>
              <p className="text-sm text-on-surface-variant mb-6">Aged poultry manure for your own backyard garden beds.</p>
              <div className="flex justify-between items-center">
                <span className="font-bold text-primary">$15.00</span>
                <span className="material-symbols-outlined text-outline cursor-pointer hover:text-primary transition-colors">add_circle</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </LightDOMContainer>
  );
}
