// Provenance: ze1ltmf9 GameContent had 24 icon-only buttons missing
// aria-label. The fixer's intended behavior is to inject
// ``aria-label="<IconName>"`` on each, derived from the child icon
// component name (Trash2 / Pencil / etc.).
//
// Historical bug — now fixed: ``iter_jsx_opening_elements`` used to
// yield all opening elements first, then all self-closing elements.
// When a self-closing icon was nested inside an opening button AND a
// sibling button followed, ``rewrite_classname_text`` consumed the
// out-of-order spans left-to-right and produced corrupt splices —
// duplicating one button as a self-closing fragment with concatenated
// className text. After fixing iter_jsx_opening_elements to walk in
// source order (single DFS yielding both element kinds), the corruption
// is structurally impossible. This snapshot now pins the correct,
// non-corrupting behavior; it serves as a regression guard against any
// future ordering regression in the foundational walker.

import { React } from '@exepad/sdk';
import { Trash2, Pencil } from "@exepad/sdk";

const C = () => (
  <div className="flex gap-2">
    <button aria-label="Trash2" type="button" className="rounded p-2 hover:bg-secondary">
      <Trash2 className="h-4 w-4" />
    </button>
    <button aria-label="Pencil" type="button" className="rounded p-2 hover:bg-secondary">
      <Pencil className="h-4 w-4" />
    </button>
    <button type="button" aria-label="Save">
      Save
    </button>
  </div>
);

export default C;
