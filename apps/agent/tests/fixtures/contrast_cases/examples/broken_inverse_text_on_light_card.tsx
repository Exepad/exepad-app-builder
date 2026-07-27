import { LightDOMContainer, React } from "@exepad/sdk";

export default function WeeklyDigestCard() {
  return (
    <LightDOMContainer>
      <section className="bg-surface-variant px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <article className="rounded-[2rem] border border-outline/50 bg-surface p-8 shadow-lg text-inverse-on-surface">
            <p className="text-sm uppercase tracking-[0.24em]">Weekly digest</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              Every account team gets the same operating snapshot.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7">
              Re-open rates, VIP escalations, reply time drift, and unresolved
              blockers are bundled into one delivery.
            </p>
          </article>
        </div>
      </section>
    </LightDOMContainer>
  );
}
