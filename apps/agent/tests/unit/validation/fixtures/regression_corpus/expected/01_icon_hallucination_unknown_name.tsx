// Provenance: synthesized from ze1ltmf9 (Super Mushroom Quest) GameContent —
// LLM emitted Icons.Circle which is not a real lucide-react icon. Caused
// React #130 ("Element type is invalid") at runtime when the unknown icon
// resolved to undefined. The icon-rescue fixer (apply_icon_fallback_only)
// substitutes a fuzzy-matched valid icon name; remaining unrescuable names
// are flagged crash-class by the unknown_icon AST rule (severity: error).
//
// What the fixer pipeline should do:
//   - Rewrite Icons.Circle → Icons.<best fuzzy match> (Circle, DollarSign, etc.)
//   - Leave Icons.Star alone (valid).

import { Icons, React } from '@exepad/sdk';
import * as Icons from "@exepad/sdk";

const C = () => (
  <div className="flex items-center gap-2">
    <Icons.Circle className="h-5 w-5" />
    <Icons.Star className="h-5 w-5" />
    <span>Hello</span>
  </div>
);

export default C;
