import { Button, LightDOMContainer, useApp } from '@exepad/sdk';

export default function HooksProblem() {
  // Hooks under conditionals break the Rules of Hooks (React error #185).
  const count = cond ? useApp(s => s.count) : null;

  // Bare ``useApp()`` returns the full snapshot → infinite re-render.
  const app = useApp();

  return (
    <LightDOMContainer>
      <section className="bg-surface p-4">
        <p>{count}</p>
        <Button aria-label="Reset">Reset</Button>
      </section>
    </LightDOMContainer>
  );
}
