// Button has visible text "Save" — accessible name comes from
// children, no aria-label injection needed.
import { Button } from "@exepad/sdk";

export default function Form() {
  return <Button onClick={() => {}}>Save</Button>;
}
