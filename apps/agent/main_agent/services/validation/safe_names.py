"""Filesystem-safe validation for LLM/user-controlled artifact names.

Component / module / sibling names arrive from free-form LLM tool-call fields
(``component_name``, ``target_module_name`` — plain ``str`` with no Pydantic
pattern) and flow all the way to ``Path(tmp) / f"{name}.tsx"`` writes in the tsc
gate and ``_write_file(dir, f"{name}.tsx", ...)`` in the final compile gate,
which runs ``os.makedirs(os.path.dirname(path))`` before opening the file. A name
like ``../../../../tmp/pwned`` therefore escapes the tempdir and writes
attacker-controlled TSX content outside it.

These helpers reject anything that is not a bare identifier BEFORE it can reach
the filesystem, and provide a realpath containment assertion for write sites.
"""

from __future__ import annotations

import os
import re

# A bare TS/JS identifier — no path separators, dots, or traversal. Mirrors the
# runtime's VALID_IDENTIFIER_PATTERN (packages/types) so agent-side names stay in
# the same namespace the runtime will accept.
_SAFE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class UnsafeArtifactName(ValueError):
    """Raised when an artifact name is not a bare identifier (path-traversal risk)."""


def is_safe_artifact_name(name: object) -> bool:
    """True iff ``name`` is a string matching ``^[A-Za-z_][A-Za-z0-9_]*$``."""
    return isinstance(name, str) and bool(_SAFE_NAME_RE.match(name))


def assert_inside_dir(directory: str, path: str) -> None:
    """Assert that ``path`` resolves to a location inside ``directory``."""
    root = os.path.realpath(directory)
    target = os.path.realpath(path)
    if target != root and not target.startswith(root + os.sep):
        raise UnsafeArtifactName(f"Path {path!r} escapes {directory!r}")
