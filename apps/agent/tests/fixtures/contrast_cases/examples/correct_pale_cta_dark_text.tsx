import { LightDOMContainer, React, navigate } from "@exepad/sdk";

export default function PricingCallout() {
  return (
    <LightDOMContainer>
      <section className="bg-surface px-6 py-16">
        <div className="mx-auto max-w-5xl rounded-[2rem] bg-[#f8fafc] p-8 shadow-sm">
          <div className="flex items-end justify-between gap-8">
            <div className="max-w-2xl space-y-3">
              <p className="text-sm uppercase tracking-[0.24em] text-[#64748b]">
                Launch plan
              </p>
              <h2 className="text-4xl font-semibold tracking-tight text-on-surface">
                Start with one shared inbox and one workflow coach.
              </h2>
            </div>
            <button
              onClick={() => navigate("/signup")}
              className="inline-flex items-center justify-center rounded-full bg-[#e2e8f0] px-6 py-3 text-sm font-semibold text-[#0f172a]"
            >
              Start free
            </button>
          </div>
        </div>
      </section>
    </LightDOMContainer>
  );
}
