/**
 * Regression: scope-blind static-image rewriter (RetailFlux, 2026-04-21).
 *
 * The fixer must rewrite static src ONLY inside the .map() callback —
 * never outside it. The pre-fix implementation used a 3000-char text window
 * and rewrote sibling JSX, producing runtime ReferenceError because the map
 * param was not in scope.
 *
 * This fixture has two static images:
 *   1. Inside the features.map(...) callback — should be rewritten to
 *      src={feature.image} and the source array should gain
 *      image: "__PLACEHOLDER__" entries.
 *   2. Outside the .map() (in the trailing footer) — uses an allowed
 *      domain so neither the hallucinated-URL fixer nor the raw-img
 *      converter touches it. Pre-fix, the map fixer would have rewritten
 *      its src to src={feature.image}, crashing at runtime.
 */
const features = [
  { id: 1, title: "Speed" },
  { id: 2, title: "Reliability" },
];

export default function FeatureGrid() {
  return (
    <section>
      <ul>
        {features.map((feature) => (
          <li key={feature.id}>
            <img src="https://example.test/inside.jpg" alt={feature.title} />
            <h3>{feature.title}</h3>
          </li>
        ))}
      </ul>
      <footer>
        <img
          src="https://storage.googleapis.com/exepad-published/footer-logo.webp"
          alt="footer logo"
        />
      </footer>
    </section>
  );
}
