// Provenance: foundational walker ordering regression guard. After the
// iter_jsx_opening_elements source-order fix, classNames at any nesting
// depth — including self-closing children of opening parents at multiple
// levels — should be processed in source order by every fixer that uses
// rewrite_classname_text or JsxAstMutator.iter_classnames.
//
// Pattern stresses the "openings interleaved with self-closings at
// multiple depths" shape that previously broke the ordering. If a
// future change reintroduces non-source-order iteration, this fixture's
// snapshot diff fires immediately — multiple fixers would simultaneously
// mis-splice the className spans.

import React from "react";
import { Search, Bell, User } from "lucide-react";

const C = () => (
  <div className="flex flex-col gap-4 bg-surface text-on-surface">
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4" />
        <span className="text-sm">search</span>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="rounded p-2">
          <Bell className="h-5 w-5" />
        </button>
        <button type="button" className="rounded p-2">
          <User className="h-5 w-5" />
        </button>
      </div>
    </header>
    <main className="grid grid-cols-2 gap-2">
      <section className="rounded p-4 bg-primary">
        <h2 className="text-lg">First</h2>
        <p className="text-sm">First section</p>
      </section>
      <section className="rounded p-4 bg-secondary">
        <h2 className="text-lg">Second</h2>
        <p className="text-sm">Second section</p>
      </section>
    </main>
  </div>
);

export default C;
