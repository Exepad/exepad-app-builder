import { React, LightDOMContainer } from "@exepad/sdk";

export default function GameContent() {
  return (
    <LightDOMContainer>
      <div className="overflow-hidden bg-surface w-full h-full relative">
        <canvas />
      </div>
    </LightDOMContainer>
  );
}
