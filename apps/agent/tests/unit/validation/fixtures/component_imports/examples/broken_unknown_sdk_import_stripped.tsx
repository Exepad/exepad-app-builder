// "B-u-t-t-n" is a misspelling — not in the SDK catalog. The fixer must
// strip it from the import list and report the removal.
import { Button, Buttn, React } from "@exepad/sdk";

export default function Cta() {
  return <Button>Click</Button>;
}
