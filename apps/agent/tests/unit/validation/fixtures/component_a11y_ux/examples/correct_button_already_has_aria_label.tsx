// Button already has aria-label — fixer must not re-inject or modify.
import { Button, Icons } from "@exepad/sdk";

export default function Toolbar() {
  return (
    <Button aria-label="Open menu" onClick={() => {}}>
      <Icons.Menu />
    </Button>
  );
}
