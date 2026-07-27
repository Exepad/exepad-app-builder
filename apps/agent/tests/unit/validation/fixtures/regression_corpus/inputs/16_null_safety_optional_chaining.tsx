// Provenance: useModel returns null/undefined while the network round-trip
// resolves; LLM bare-accesses fields off it (`items.length`, `items.map`)
// and the first paint crashes. The null_safety fixer injects optional
// chaining + null fallbacks for known model bindings.

import React from "react";
import { useModel } from "@exepad/sdk";

const C = () => {
  const items = useModel("items");
  return (
    <div>
      <p>{items.length} items</p>
      <ul>
        {items.map((it) => (
          <li key={it.id}>{it.name}</li>
        ))}
      </ul>
    </div>
  );
};

export default C;
