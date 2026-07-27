// Provenance: LLM emits `https://via.placeholder.com/...` URLs for
// images. The published runtime can't reach via.placeholder.com (CSP +
// rate-limited), so every image falls back to broken thumbnails. The
// urls_images fixer rewrites placeholder.com URLs to the sibling-image
// fallback path the runtime serves locally.

import { ExepadImage, React } from '@exepad/sdk';

const C = () => (
  <div className="grid grid-cols-2 gap-3">
    <ExepadImage keywords="hero with detailed scene and natural lighting" importance={5} className="w-full" width={800} height={600} />
    <ExepadImage keywords="thumb with detailed scene and natural lighting" importance={5} className="w-full" width={800} height={600} />
  </div>
);

export default C;
