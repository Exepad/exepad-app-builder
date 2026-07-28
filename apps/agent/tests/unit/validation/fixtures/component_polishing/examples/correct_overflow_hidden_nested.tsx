import { React, LightDOMContainer } from "@exepad/sdk";

// overflow-hidden on a nested element is fine — the rule only fires on
// the root child of LightDOMContainer. The fixer must leave nested
// overflow-hidden tokens alone.
export default function NestedOverflow() {
  return (
    <LightDOMContainer>
      <div className="bg-surface w-full">
        <div className="overflow-hidden rounded-lg">
          <img alt="hero" />
        </div>
      </div>
    </LightDOMContainer>
  );
}
