// Provenance: a11y_ux audit (regex-on-raw-TSX). The status-keys
// lowercaser uses ``re.sub(r"\{[^{}]{20,500}\}", ...)`` over raw TSX.
// The internal guard requires ≥2 title-case status-word keys in the
// brace block before mutating. This fixture stresses the pattern by
// placing a real status map adjacent to JSX expression bodies — the
// regex must NOT match across the JSX boundaries.
//
// Expected: keys in the status map (Paid, Pending, Draft, Sent) are
// lowercased; the JSX expression `{status === 'Paid' ? ... }` is left
// alone (no key-shaped pair inside).

import React from "react";

const STATUS_STYLES = {
  Paid: "bg-green-100 text-green-800",
  Pending: "bg-yellow-100 text-yellow-800",
  Draft: "bg-gray-100 text-gray-800",
  Sent: "bg-blue-100 text-blue-800",
};

const C = ({ status }: { status: string }) => (
  <div className="p-4">
    <span className={status === 'Paid' ? STATUS_STYLES.Paid : STATUS_STYLES.Draft}>
      {status}
    </span>
  </div>
);

export default C;
