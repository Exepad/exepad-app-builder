import { React, LightDOMContainer, Button } from "@exepad/sdk";

export function FAQContent() {
  return (
    <LightDOMContainer>
      <section className="py-20">
        <h2 className="text-5xl font-headline text-primary">Frequently Asked Questions</h2>
        <p className="text-on-surface-variant">Everything you need to know.</p>
        <h2 className="text-2xl mt-12">Booking & Scheduling</h2>
        <h3 className="text-lg">How far in advance should I book?</h3>
      </section>
    </LightDOMContainer>
  );
}
