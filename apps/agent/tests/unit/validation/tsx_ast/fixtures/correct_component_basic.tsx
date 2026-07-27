import { Button, LightDOMContainer } from '@exepad/sdk';

export default function Hero() {
  return (
    <LightDOMContainer>
      <section className="bg-surface text-on-surface p-8">
        <h1 className="text-4xl font-semibold">Welcome</h1>
        <p className="text-on-surface-variant">Mission statement goes here.</p>
        <Button aria-label="Get started">Get started</Button>
      </section>
    </LightDOMContainer>
  );
}
