// Provenance: closely-spelled lucide names (e.g. `Trash` instead of
// `Trash2`, `Settings` vs `Cog`, `Star` vs `Stars`). The component_typos
// + component_urls_images fixers fuzzy-match unknown PascalCase imports
// from `lucide-react` to the closest valid name. Below: `Trash` and
// `Settings` are valid, but `Garbage` and `Gear` are not — they should
// be rescued to a near match.

import { React } from '@exepad/sdk';
import { Trash, Settings, Garbage, Gear } from "@exepad/sdk";

const C = () => (
  <div className="flex gap-2">
    <Trash className="h-4 w-4" />
    <Settings className="h-4 w-4" />
    <Garbage className="h-4 w-4" />
    <Gear className="h-4 w-4" />
  </div>
);

export default C;
