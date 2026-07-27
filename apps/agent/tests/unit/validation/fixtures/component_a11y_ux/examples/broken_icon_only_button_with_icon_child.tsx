// Icon-only <Button> with a single <Icons.Menu /> child and no
// accessible name. Fixer derives "Menu" from the icon and injects
// aria-label="Menu" right after the tag name.
import { Button, Icons, React } from "@exepad/sdk";

export default function Header() {
  const [open, setOpen] = React.useState(false);
  return (
    <header>
      <Button onClick={() => setOpen(!open)}>
        <Icons.Menu />
      </Button>
    </header>
  );
}
