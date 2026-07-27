// Provenance: same root cause as #05 (LLM tries the "selector" pattern
// but writes an inline object literal that re-allocates every render —
// `Object.is` snapshot comparison never sees stable equality, infinite
// re-render loop). AST fixer rewrites to per-key selectors.

import { React, useApp } from '@exepad/sdk';
import { useApp } from "@exepad/sdk";

const C = () => {
  const count = useApp(s => s.count);
const name = useApp(s => s.name);
  return <div>{name}: {count}</div>;
};

export default C;
