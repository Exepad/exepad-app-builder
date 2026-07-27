// Already-clean component: no status maps with title-case keys, no
// DialogContent, no Trigger asChild, no status string literals matching
// the catalog. The fixer must be a complete no-op.
import { Button } from "@exepad/sdk";

export default function CleanComponent() {
  return (
    <section>
      <h2>Welcome</h2>
      <Button>Continue</Button>
    </section>
  );
}
