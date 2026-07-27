// Provenance: kbca71jk-style first-paint layout shift. LLM emits
// `animate-in ... duration-N` on a JSX element with no explicit transition
// class. Tailwind v4's `.duration-N` rule sets `transition-duration: Ns`
// without a `transition-property`, so the spec defaults to `all` — every
// computed-style change interpolates over N ms. When React mutates the
// className between branches (loading → loaded), the user sees a visible
// shift on first paint.
//
// The polishing fixer rewrites bare `duration-N` inside `animate-in`-tagged
// classNames to the arbitrary-value form `[animation-duration:Nms]`, which
// sets ONLY `animation-duration` and leaves `transition-property` unset.
// classNames that already opt into transitions explicitly are left alone.

import React from "react";

const C = () => (
  <div>
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      bare duration — should be rewritten
    </div>
    <div className="animate-in fade-in transition-all duration-300">
      explicit transition — should stay
    </div>
    <div className="data-[state=open]:animate-in data-[state=open]:duration-200">
      data-state opt-in — should stay
    </div>
  </div>
);

export default C;
