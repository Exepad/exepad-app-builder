// Button is in the SDK catalog (327 exports). JSX usage without import
// triggers the missing-import auto-add via the catalog scan.
import { React } from "@exepad/sdk";

export default function Cta() {
  return <Button>Click</Button>;
}
