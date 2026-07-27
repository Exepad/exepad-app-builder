// Provenance: WCAG AA contrast violations on light backgrounds. LLMs love
// `text-gray-300` / `text-slate-400` / similar borderline shades for
// "muted" text, but they fail WCAG AA on white/near-white backgrounds.
//
// Polishing rewrites bare `text-{gray|slate|zinc|neutral|stone}-{300|400}`
// to shade 600. CRITICAL: variant-prefixed forms (`dark:text-gray-400`,
// `hover:text-slate-300`) are left intact — a dark-mode variant uses a
// light gray ON dark, where 300 is the correct shade.

import React from "react";

const C = () => (
  <div className="bg-surface text-on-surface">
    <p className="text-gray-300">should rewrite to 600</p>
    <p className="text-slate-400">should rewrite to 600</p>
    <p className="dark:text-gray-300 text-on-surface">dark variant — keep</p>
    <p className="hover:text-slate-400 text-on-surface">hover variant — keep</p>
  </div>
);

export default C;
