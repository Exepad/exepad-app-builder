const navLinks = [
  { href: "products", label: "Products" },
  { href: "pricing", label: "Pricing" },
  { href: "https://github.com/exepad", label: "GitHub" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function NavBar() {
  return (
    <nav>
      {navLinks.map((link) => (
        <a key={link.label} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}
