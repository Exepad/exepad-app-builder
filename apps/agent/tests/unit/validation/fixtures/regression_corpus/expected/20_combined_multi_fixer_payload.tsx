// Provenance: integration case — multiple fixers fire on the same input.
// Tests interaction order and per-fixer rollback (Change A): if any one
// fixer corrupts JSX, only that fixer rolls back; the others' fixes
// survive. Also verifies the `[<fixer>]` prefix on each fix entry.

import React, { useState } from "react";
import { navigate, useApp, useHandler } from '@exepad/sdk';

const C = () => {
  const [items, setItems] = useState<any[]>([]);
  const onSave = useHandler("save");
  const me = useApp((s) => s.user);

  return (
    <div className="bg-surface text-on-surface">
      <p className="text-gray-600">muted heading</p>
      <div className="animate-in fade-in [animation-duration:300ms]">
        <CircleDollarSign className="h-5 w-5" />
        <button aria-label="CircleDollarSign" type="button" onClick={() => {
          navigate("/items");
        }}>
          <CircleDollarSign className="h-4 w-4" />
        </button>
      </div>
      <p>{me?.name}</p>
      <p>{items.length} items</p>
    </div>
  );
};

export default C;
