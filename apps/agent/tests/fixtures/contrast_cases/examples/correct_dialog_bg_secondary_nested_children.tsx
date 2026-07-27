import { LightDOMContainer, React } from "@exepad/sdk";

/**
 * Second real-world pattern from the same MembersContent component.
 * A dialog panel with an explicit `bg-secondary` wrapper and multiple
 * child elements that restate `text-on-secondary` for clarity.  This is
 * the pattern recommended by 10_COLOR_AND_LAYOUT.md (pair every bg-X with
 * a matching text-on-X).  The detector must treat it as correct.
 */
export default function MemberDialog() {
  return (
    <LightDOMContainer>
      <div className="p-8 bg-secondary text-on-secondary">
        <div className="flex justify-between items-start mb-6">
          <button className="text-on-secondary">
            Close
          </button>
        </div>
        <h2 className="text-3xl font-headline font-black tracking-tight">
          Jane Doe
        </h2>
        <p className="text-on-secondary font-medium">jane@example.com</p>
        <p className="text-on-secondary text-sm mt-1">
          Update profile information and membership standing.
        </p>
      </div>
    </LightDOMContainer>
  );
}
