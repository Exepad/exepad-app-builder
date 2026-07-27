// Provenance: canvas/sprite root containers — LLM frequently emits
// `<LightDOMContainer><div className="overflow-hidden ...">` to clip
// off-canvas sprites. `overflow-hidden` clips both axes — including
// vertical page scroll on long pages — so the user can't scroll past
// the canvas region.
//
// The polishing fixer rewrites the bare `overflow-hidden` token on the
// root child only to `overflow-x-clip`, preserving horizontal clipping
// without disabling page scroll. Variants like `hover:overflow-hidden`
// stay intact.

import React from "react";
import { LightDOMContainer } from "@exepad/sdk";

const C = () => (
  <LightDOMContainer>
    <div className="relative w-full overflow-hidden bg-surface">
      <div className="absolute left-0 top-0">sprite</div>
    </div>
  </LightDOMContainer>
);

export default C;
