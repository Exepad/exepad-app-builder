// Provenance: deleted-but-historical broken_hover_overlay_high_opacity
// fixture from component_polishing — LLM emits `hover:bg-primary/80` on
// a card surface, which makes hover entirely overpaint the underlying
// content. Polishing clamps `bg-*/N` opacities above 60 down to 30 for
// hover-only contexts so hover hints stay visible without obliterating
// child contrast.

import React from "react";

const C = () => (
  <div className="grid grid-cols-2 gap-4">
    <div className="rounded p-4 bg-surface hover:bg-primary/80 transition-colors">
      hover overlay too opaque
    </div>
    <div className="rounded p-4 bg-surface hover:bg-primary/30 transition-colors">
      hover overlay already safe
    </div>
  </div>
);

export default C;
