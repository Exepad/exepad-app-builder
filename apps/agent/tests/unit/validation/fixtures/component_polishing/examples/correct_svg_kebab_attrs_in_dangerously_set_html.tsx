// Issue #2b regression: SVG kebab attributes inside dangerouslySetInnerHTML,
// JSDoc comments mentioning Tailwind classes, and string literals quoting
// class shapes must NOT trigger any polishing rewrite.
const SVG_ICON = `<svg viewBox="0 0 24 24">
  <text text-anchor="middle">x</text>
</svg>`;

// In comments: text-gray-300 / text-slate-400 / hover:bg-white/30 / text-[7px]
// stay verbatim.

const ERROR_MSG = "Use the text-zinc-300 utility for muted text";

export default function Card() {
  return (
    <div className="bg-primary text-on-primary">
      <div dangerouslySetInnerHTML={{ __html: SVG_ICON }} />
      <p>{ERROR_MSG}</p>
    </div>
  );
}
