// Provenance: every Code Focus build — the LLM defaults to bare
// destructure of `useApp()`. The store snapshot is the entire app state
// object; mutating any unrelated key triggers a re-render through the
// useSyncExternalStore Object.is check. The AST-based useApp_destructure
// fixer (apply_auto_fixes -> rewrite_useapp_destructures) rewrites
// each destructured key into its own per-key selector call.

import React from "react";
import { useApp } from "@exepad/sdk";

const C = () => {
  const { count, name, pageTitle } = useApp();
  return (
    <div>
      <h1>{pageTitle}</h1>
      <p>{name}</p>
      <p>count: {count}</p>
    </div>
  );
};

export default C;
