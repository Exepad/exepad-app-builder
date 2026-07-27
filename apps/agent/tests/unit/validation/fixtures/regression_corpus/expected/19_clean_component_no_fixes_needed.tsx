// Provenance: regression-detection baseline of MINIMAL fixer activity —
// a clean component that exercises only the always-on `imports` fixer
// (which rewrites `react` → `@exepad/sdk` for every component, by policy).
// The snapshot pins both that import rewrite AND any future regression
// where another fixer starts touching idiomatic, well-formed code.

import { React, useApp } from '@exepad/sdk';
import { useApp } from "@exepad/sdk";

const HelloCard = () => {
  const name = useApp((s) => s.name);
  return (
    <div className="rounded-lg p-4 bg-surface text-on-surface">
      <p className="text-sm">Hello, {name ?? "world"}.</p>
    </div>
  );
};

export default HelloCard;
