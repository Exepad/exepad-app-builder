// Logo link: an <a> wrapping an <img alt="Acme"/>. The image's alt text
// supplies the link's accessible name, so this is NOT icon-only and the
// fixer must leave it untouched (no aria-label injected).
import { React } from "@exepad/sdk";

export default function Header() {
  return (
    <header>
      <a href="/">
        <img alt="Acme" src="/logo.svg" className="h-8 w-auto" />
      </a>
    </header>
  );
}
