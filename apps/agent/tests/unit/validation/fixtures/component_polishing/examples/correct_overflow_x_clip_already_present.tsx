import { React, LightDOMContainer } from "@exepad/sdk";

// Already using overflow-x-clip — fixer must be a no-op (no fix applied,
// no warning fired by the companion rule).
export default function CorrectClip() {
  return (
    <LightDOMContainer>
      <div className="overflow-x-clip bg-surface w-full">
        <canvas />
      </div>
    </LightDOMContainer>
  );
}
