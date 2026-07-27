import { LightDOMContainer, React } from "@exepad/sdk";

// Real-world pattern harvested from session-20260415T091442-0dab09 /
// MembersContent_c4664463dd58591e_v1.tsx.
//
// A table header with bg-secondary as the parent and repeated
// text-on-secondary tokens on each th child.  The LLM did the right
// thing: each child explicitly restates its text token so the class is
// stable under Tailwind JIT purge and refactors.  The detector must NOT
// flag these children as "text-on-secondary on light/default surfaces"
// — that is a false-positive cascade, because every child inherits from
// the explicit bg-secondary parent.
export default function MembersTable() {
  return (
    <LightDOMContainer>
      <table className="w-full">
        <thead className="bg-secondary">
          <tr className="hover:bg-transparent border-none">
            <th className="text-on-secondary font-bold text-[11px] uppercase tracking-widest py-5">
              Name
            </th>
            <th className="text-on-secondary font-bold text-[11px] uppercase tracking-widest">
              Email
            </th>
            <th className="text-on-secondary font-bold text-[11px] uppercase tracking-widest">
              Tier
            </th>
            <th className="text-on-secondary font-bold text-[11px] uppercase tracking-widest">
              Join Date
            </th>
            <th className="text-on-secondary font-bold text-[11px] uppercase tracking-widest text-center">
              Status
            </th>
            <th className="w-12 text-on-secondary"></th>
          </tr>
        </thead>
      </table>
    </LightDOMContainer>
  );
}
