// Provenance: LLM emits `https://via.placeholder.com/...` URLs for
// images. The published runtime can't reach via.placeholder.com (CSP +
// rate-limited), so every image falls back to broken thumbnails. The
// urls_images fixer rewrites placeholder.com URLs to the sibling-image
// fallback path the runtime serves locally.

import React from "react";

const C = () => (
  <div className="grid grid-cols-2 gap-3">
    <img src="https://via.placeholder.com/400x300" alt="hero" className="w-full" />
    <img src="https://via.placeholder.com/200" alt="thumb" className="w-full" />
  </div>
);

export default C;
