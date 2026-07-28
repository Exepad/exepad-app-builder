// Provenance: a11y_ux status-key lowercaser audit (Change J). The AST
// migration preserves the legacy "≥2 title-case status hits required"
// guard — a single Title-cased key alone is not enough to fire the
// rewrite (could be a deliberate enum-like map). This fixture pins the
// behaviour: an object literal with only one status word stays
// unchanged.

import { React } from '@exepad/sdk';

const SINGLE_KEY = {
  Paid: "bg-green-100",
  open: "bg-blue-100",
};

const C = () => (
  <div>
    <span className={SINGLE_KEY.Paid}>paid</span>
    <span className={SINGLE_KEY.open}>open</span>
  </div>
);

export default C;
