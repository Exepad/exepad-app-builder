// Provenance: integration case — multiple fixers fire on the same input.
// Tests interaction order and per-fixer rollback (Change A): if any one
// fixer corrupts JSX, only that fixer rolls back; the others' fixes
// survive. Also verifies the `[<fixer>]` prefix on each fix entry.

import React, { useState } from "react";
import { CircleDollarSign } from "lucide-react";

const C = () => {
  const [items, setItems] = useState([]);
  const onSave = useHandler("save");
  const me = useApp((s) => s.user);

  return (
    <div className="bg-surface text-on-surface">
      <p className="text-gray-300">muted heading</p>
      <div className="animate-in fade-in duration-300">
        <CircleDollarSign className="h-5 w-5" />
        <button type="button" onClick={() => {
          console.log("clicked");
          window.location.href = "/items";
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
