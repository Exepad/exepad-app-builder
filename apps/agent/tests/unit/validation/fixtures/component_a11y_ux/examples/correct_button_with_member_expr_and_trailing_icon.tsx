// The exact MainHeader pattern from luna-rest (jmhd6gv7) that produced
// the wrong aria-label="ChevronRight" injection. Visible text comes from
// the member expression {link.label}; the trailing <Icons.ChevronRight/>
// is decorative. Button is NOT icon-only — no injection wanted.
import { Button, Icons } from "@exepad/sdk";

export default function NavList({ links, navigate }) {
  return (
    <>
      {links.map((link) => (
        <button key={link.href} onClick={() => navigate(link.href)}>
          {link.label}
          <Icons.ChevronRight className="w-5 h-5" />
        </button>
      ))}
    </>
  );
}
