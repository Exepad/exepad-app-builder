// Provenance: LLM emits `window.location.href = "/dashboard"` for
// programmatic navigation. This works in the runtime but blows up the
// browser back/forward stack and forces a full reload — the SDK
// `navigate(path)` hook is the right call. The forbidden_apis fixer
// rewrites the assignment, then the imports fixer auto-adds `navigate`
// to the SDK import line.

import { React, navigate } from '@exepad/sdk';

const C = () => (
  <button
    type="button"
    onClick={() => {
      navigate("/dashboard");
    }}
  >
    Go to dashboard
  </button>
);

export default C;
