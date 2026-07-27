// Provenance: Material 3 color contract — every `bg-X` should pair with
// `text-on-X`, otherwise body text falls back to whatever inherits and
// often fails contrast. m3_colors fixer auto-pairs known background
// tokens with their canonical on-token (track 2 pairing).

import React from "react";

const C = () => (
  <div className="flex flex-col gap-2">
    <div className="rounded p-4 bg-primary">
      missing pair — should get text-on-primary
    </div>
    <div className="rounded p-4 bg-secondary text-on-secondary">
      already paired — should stay
    </div>
    <div className="rounded p-4 bg-tertiary">
      missing pair — should get text-on-tertiary
    </div>
  </div>
);

export default C;
