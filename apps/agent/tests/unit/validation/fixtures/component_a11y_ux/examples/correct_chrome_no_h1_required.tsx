import { React, LightDOMContainer, navigate } from "@exepad/sdk";

export function MainHeader() {
  return (
    <LightDOMContainer>
      <header>
        <h2 className="text-xl">Apex Relocation</h2>
        <nav>
          <a onClick={() => navigate("/")}>Home</a>
        </nav>
      </header>
    </LightDOMContainer>
  );
}
