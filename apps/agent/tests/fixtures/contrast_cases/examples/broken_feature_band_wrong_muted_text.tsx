import { LightDOMContainer, React } from "@exepad/sdk";

export default function FeatureBand() {
  return (
    <LightDOMContainer>
      <section className="bg-primary px-6 py-20 text-on-surface-variant">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-5">
            <p className="text-sm uppercase tracking-[0.24em]">Workflow studio</p>
            <h2 className="text-4xl font-semibold tracking-tight text-on-surface">
              Launch SOP-grade replies without writing one more playbook.
            </h2>
            <p className="max-w-2xl text-lg leading-8">
              Sales, support, and customer success can share the same routing,
              escalation, and draft review logic.
            </p>
          </div>
          <article className="rounded-[2rem] bg-primary/80 p-6 text-on-surface">
            <p className="text-sm uppercase tracking-[0.24em]">What ships on day one</p>
            <ul className="mt-4 space-y-3 text-sm leading-7">
              <li>Shared inbox triage</li>
              <li>Draft review queue</li>
              <li>VIP escalation lane</li>
            </ul>
          </article>
        </div>
      </section>
    </LightDOMContainer>
  );
}
