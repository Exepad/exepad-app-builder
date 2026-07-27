import { React, useApp } from "@exepad/sdk";

export default function CounterDisplay() {
  const { count, label } = useApp();
  return (
    <div>
      <span>{label}</span>
      <span>{count}</span>
    </div>
  );
}
