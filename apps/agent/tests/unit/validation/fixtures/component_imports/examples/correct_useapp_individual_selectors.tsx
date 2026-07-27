import { React, useApp } from "@exepad/sdk";

export default function CounterDisplay() {
  const count = useApp((s) => s.count);
  const label = useApp((s) => s.label);
  return (
    <div>
      <span>{label}</span>
      <span>{count}</span>
    </div>
  );
}
