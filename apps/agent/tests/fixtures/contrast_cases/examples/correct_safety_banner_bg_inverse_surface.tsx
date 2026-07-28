import { Icons, LightDOMContainer, React } from "@exepad/sdk";

// Harvested from session-20260413T181526-6f8448 — WalkersContent "Safety
// First" hero banner.  Exercises the bg-inverse-surface ancestor case
// (children correctly use text-inverse-on-surface and text-white).  The
// pre-Track-2 detector couldn't see the dark parent and flagged
// text-on-surface on line 98 in the original; the ancestor-aware
// auto-fixer rewrites it to text-inverse-on-surface in one pass and this
// correct version must stay silent.
export default function SafetyBanner() {
  return (
    <LightDOMContainer>
      <section className="px-6 md:px-10 mb-24">
        <div className="max-w-7xl mx-auto">
          <div className="bg-inverse-surface rounded-[24px] p-8 md:p-12 relative overflow-hidden flex flex-col md:flex-row items-center gap-8">
            <div className="relative z-10 flex-1 text-center md:text-left">
              <h2 className="font-headline text-2xl md:text-3xl font-bold text-inverse-on-surface mb-4">
                Safety First, Always
              </h2>
              <p className="font-body text-inverse-on-surface text-lg leading-relaxed max-w-3xl">
                Every walker at Paws & Paths undergoes a rigorous multi-stage
                background check, pet first aid certification, and 40+ hours of
                field training.
              </p>
            </div>
            <div className="flex flex-col gap-3 min-w-[200px]">
              <div className="flex items-center gap-2 text-inverse-on-surface font-bold text-sm">
                <Icons.CheckCircle2 className="w-5 h-5" />
                <span>Full Background Checks</span>
              </div>
              <div className="flex items-center gap-2 text-inverse-on-surface font-bold text-sm">
                <Icons.CheckCircle2 className="w-5 h-5" />
                <span>Pet First Aid Certified</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </LightDOMContainer>
  );
}
