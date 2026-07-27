// Icon-only <a> social link with a single <Icons.Twitter /> child and no
// accessible name (axe `link-name`). The fixer derives "Twitter" from the
// icon and injects aria-label="Twitter" right after the tag name.
import { Icons, React } from "@exepad/sdk";

export default function Footer() {
  return (
    <footer>
      <a href="https://twitter.com/acme" className="h-8 w-8 flex items-center justify-center">
        <Icons.Twitter />
      </a>
    </footer>
  );
}
