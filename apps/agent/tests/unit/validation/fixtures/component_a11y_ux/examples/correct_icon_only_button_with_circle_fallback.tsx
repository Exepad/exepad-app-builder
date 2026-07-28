// <Icons.Circle /> is the deterministic fallback for unknown icons —
// labeling a button "Circle" is misleading. Fixer must skip and let the
// warning surface so a human picks a real label.
import { Button, Icons } from "@exepad/sdk";

export default function Mystery() {
  return (
    <Button onClick={() => {}}>
      <Icons.Circle />
    </Button>
  );
}
