// Issue #2b regression: SVG kebab attributes inside dangerouslySetInnerHTML
// strings must NOT trigger any of the M3 regex rewrites.
// - text-anchor / text-decoration look like text-* opacity targets
// - bg-foo/10 in a string literal looks like a low-opacity bg
// - bg-transparent in JSDoc must not be swapped
//
// All of those live OUTSIDE className positions, so the className-text
// rewriter must leave them alone.
const SVG_ICON = `<svg viewBox="0 0 24 24">
  <text text-anchor="middle" text-decoration="none">x</text>
  <line stroke-width="2" stroke-linecap="round" stroke-dasharray="5,5" />
  <rect fill-opacity="0.5" fill-rule="evenodd" />
</svg>`;

// Comment mentions: bg-primary/10 should NOT be clamped, text-foo/85 should NOT be stripped.

const ERROR_MSG = "On hover the bg-transparent class kicks in";

export default function Header() {
  return (
    <header className="bg-primary text-white">
      <div dangerouslySetInnerHTML={{ __html: SVG_ICON }} />
      <p>{ERROR_MSG}</p>
    </header>
  );
}
