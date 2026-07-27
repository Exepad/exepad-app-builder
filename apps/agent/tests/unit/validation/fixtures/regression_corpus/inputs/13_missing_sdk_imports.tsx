// Provenance: LLM uses `useModel`, `useHandler`, `navigate`, `toast`,
// `useApp` without importing them. The imports fixer auto-adds the
// missing names to the SDK import line. Already-imported names stay.

import React from "react";
import { useApp } from "@exepad/sdk";

const C = () => {
  const items = useModel("items");
  const onSave = useHandler("save_item");
  const me = useApp((s) => s.user);
  return (
    <div>
      <p>{me?.name}</p>
      <button
        type="button"
        onClick={async () => {
          await onSave({ ok: true });
          toast.success("Saved");
          navigate("/items");
        }}
      >
        Save
      </button>
      <pre>{JSON.stringify(items, null, 2)}</pre>
    </div>
  );
};

export default C;
