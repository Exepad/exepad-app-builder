"""TypeScript compile-time gate (Phase 2).

Runs ``tsc --noEmit`` against each generated component using a
per-app ``.d.ts`` derived from the backend manifest (declared models,
handlers, state keys, page routes). Catches model / handler / icon /
state-key typos at compile time instead of runtime — replacing several
fragile cross-reference AST rules with the type system.

Public entry: :func:`run_tsc_check`. Returns a list of
:class:`Finding` objects, or an empty list when ``tsc`` isn't available
in the runtime environment (graceful degradation — the rest of the
validation pipeline still runs).

The Dockerfile installs ``nodejs`` + ``typescript@5.9`` so the binary
is on ``$PATH``. Local development without Node.js: the runner detects
``FileNotFoundError`` and returns ``[]``.
"""

from .runner import run_tsc_check

__all__ = ["run_tsc_check"]
