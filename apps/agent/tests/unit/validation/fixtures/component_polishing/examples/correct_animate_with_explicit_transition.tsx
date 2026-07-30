// Explicit `transition-*` class means the duration-N is intended for
// the transition, not the animation — fixer must leave it alone.
export default function HoverFade() {
  return (
    <div className="animate-in fade-in transition-opacity duration-300 hover:opacity-80">
      <span>Fade me</span>
    </div>
  );
}
