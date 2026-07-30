// Provenance: LLM occasionally writes inline style props with CSS
// kebab-case keys (`background-color`, `font-size`) — invalid in JSX,
// React ignores them silently and the visual styling is missing. The
// inline_styles fixer rewrites known kebab keys to camelCase.

import { React } from '@exepad/sdk';

const C = () => (
  <div
    style={{
      "background-color": "var(--color-surface)",
      "font-size": "14px",
      color: "var(--color-on-surface)",
    } as React.CSSProperties}
  >
    inline styled
  </div>
);

export default C;
