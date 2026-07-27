import { LightDOMContainer, React } from "@exepad/sdk";

export default function HeroBadge() {
  return (
    <LightDOMContainer>
      <section className="bg-surface px-6 py-20">
        <div className="mx-auto max-w-5xl space-y-8">
          <span className="inline-flex rounded-full border border-outline px-4 py-2 text-sm font-medium text-on-surface-variant">
            AI triage for overloaded inboxes
          </span>
          <div className="max-w-3xl space-y-4">
            <h1 className="text-5xl font-semibold tracking-tight text-on-surface">
              Turn repetitive email into one-click workflows.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-on-surface-variant">
              Route, summarize, draft, and escalate without asking your team to live
              in another dashboard.
            </p>
          </div>
        </div>
      </section>
    </LightDOMContainer>
  );
}
