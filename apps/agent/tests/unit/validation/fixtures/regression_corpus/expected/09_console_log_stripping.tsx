// Provenance: LLM emits `console.log` / `console.error` /
// `console.warn` everywhere during plan/build, polluting the browser
// console for the end user. `forbidden_apis` strips all five console
// methods (log, warn, error, info, debug) using a paren-balanced
// scanner that handles inline calls, nested args, and template literals.

import { React } from '@exepad/sdk';

const C = () => {
  React.useEffect(() => {
  }, []);
  return <div>silent</div>;
};

export default C;
