// Provenance: a11y_ux DialogDescription injection — historically used
// the substring check ``"<DialogDescription" in tsx`` plus
// ``re.sub(r"(<DialogContent\b[^>]*>)", ..., count=1)`` over raw TSX,
// which incorrectly matched JSDoc comments mentioning the literal
// strings ``<DialogContent>`` / ``<DialogDescription>``.
//
// Historical bug — now fixed: a JSDoc mentioning ``<DialogDescription>``
// caused the fixer to believe the description was already in JSX, so
// it took the "imported only" path. The real ``<DialogContent>``
// element shipped without a screen-reader description child.
//
// Post-Change-J (AST migration): the fixer walks ``jsx_opening_element``
// nodes by tag name, so JSDoc / comment mentions are structurally
// invisible. Snapshot now pins the correct behaviour: the real
// ``<DialogContent>`` gets a ``<DialogDescription className="sr-only">``
// child, and the SDK import is updated accordingly.

import React from "react";
import { Dialog, DialogContent, DialogTrigger } from "@exepad/sdk";

/**
 * Modal helper. Wraps children in a <DialogContent> shell with a
 * default close button. The companion <DialogDescription> is auto-
 * injected by the fixer when missing.
 */
const C = () => (
  <Dialog>
    <DialogTrigger>Open</DialogTrigger>
    <DialogContent>
      <h2>Confirm</h2>
    </DialogContent>
  </Dialog>
);

export default C;
