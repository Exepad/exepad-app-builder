// Provenance: a11y_ux status-arg lowercaser audit (Change J). The
// historical regex used a string-replace approach that occasionally
// rewrote occurrences of the status word inside the camelCase function
// name itself (e.g., ``saveDraft("Draft")`` → ``savedraft("draft")``
// corrupted the call site). The AST migration replaces only the inner
// text of the string-literal argument, leaving the function name's
// bytes untouched.
//
// This fixture pins the safe behaviour for the historically-corrupting
// shape.

import React from "react";

const C = () => {
  const onClick = () => {
    saveDraft("Draft");
    markPaid("Paid");
    handleSent("Sent");
  };
  return <button onClick={onClick}>Save</button>;
};

const saveDraft = (s: string) => s;
const markPaid = (s: string) => s;
const handleSent = (s: string) => s;

export default C;
