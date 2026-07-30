// Button's visible text comes from a jsx_expression child
// (`{filter}`). It is NOT icon-only — aria-label must not be injected.
// Regression: ReviewsContent filter pills on luna-rest (jmhd6gv7)
// were previously flagged as icon-only because the visible-text
// detector only scanned ``jsx_text`` nodes.
import { Button } from "@exepad/sdk";

export default function FilterPills({ filters, activeFilter, setActiveFilter }) {
  return (
    <>
      {filters.map((filter) => (
        <button key={filter} onClick={() => setActiveFilter(filter)}>
          {filter}
        </button>
      ))}
    </>
  );
}
