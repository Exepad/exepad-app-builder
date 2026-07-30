// Provenance: same root cause as #05 (LLM tries the "selector" pattern
// but writes an inline object literal that re-allocates every render —
// `Object.is` snapshot comparison never sees stable equality, infinite
// re-render loop). AST fixer rewrites to per-key selectors.

import React from "react";
import { useApp } from "@exepad/sdk";

const C = () => {
  const { count, name } = useApp((s) => ({ count: s.count, name: s.name }));
  return <div>{name}: {count}</div>;
};

export default C;
