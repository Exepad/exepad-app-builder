"""Artifact search and edit primitives for ComponentBuilderMultiple.

Three Claude-Code-style operations mapped onto the virtual artifact
namespace:

- ``list_artifacts_by_pattern`` — Glob; fnmatch over artifact names.
- ``search_artifact_contents`` — Grep; regex over artifact bodies.
- ``apply_edit_to_artifact`` — Edit; surgical string replace.

All three operate on the in-memory frontend artifact set
(``codefocus_component:*.tsx``, ``codefocus_module:*.tsx``,
``codefocus_style:theme.css``). Backend artifacts (``handler_code:*``,
``backend.json``, seeds) are deliberately out of scope — they have
specialized builders.
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass

# Frontend prefix allowlist. Used as the default scope for list/search and
# enforced as the write surface for edit/save/delete tools.
FRONTEND_ARTIFACT_PREFIXES: tuple[str, ...] = (
    "codefocus_component:",
    "codefocus_module:",
    "codefocus_style:",
)


def is_frontend_artifact_name(filename: str) -> bool:
    """Return True when the artifact name is in the agent's writable surface."""
    return any(filename.startswith(p) for p in FRONTEND_ARTIFACT_PREFIXES)


# --------------------------------------------------------------------------- #
# Glob — list_artifacts_by_pattern
# --------------------------------------------------------------------------- #


def list_artifacts_by_pattern(
    pattern: str,
    available_names: list[str],
) -> list[str]:
    """Return frontend artifact names matching the fnmatch pattern.

    Names outside the frontend prefix allowlist are filtered out
    regardless of the pattern (so ``codefocus_*`` users never see
    backend artifacts). Returns sorted, dedup'd matches.
    """
    matches: set[str] = set()
    for name in available_names:
        if not is_frontend_artifact_name(name):
            continue
        if fnmatch.fnmatchcase(name, pattern):
            matches.add(name)
    return sorted(matches)


# --------------------------------------------------------------------------- #
# Grep — search_artifact_contents
# --------------------------------------------------------------------------- #


@dataclass
class GrepHit:
    filename: str
    line_no: int
    line: str
    byte_offset: int


def _build_regex(pattern: str, flags: list[str] | None) -> re.Pattern[str]:
    re_flags = 0
    if flags:
        for f in flags:
            if f == "i":
                re_flags |= re.IGNORECASE
            elif f == "m":
                re_flags |= re.MULTILINE
    return re.compile(pattern, re_flags)


def search_artifact_contents(
    pattern: str,
    artifact_sources: dict[str, str],
    *,
    name_glob: str = "codefocus_*",
    flags: list[str] | None = None,
    max_results: int = 200,
) -> tuple[list[GrepHit], bool]:
    """Regex search across artifact contents.

    Returns ``(hits, truncated)``. ``truncated`` is True when the result
    set was capped at ``max_results``.

    Unlike ``find_symbol_references``, this is a dumb regex match — it
    matches inside string literals and comments. Callers should prefer
    the symbol-aware tool for symbol-scoped queries.
    """
    regex = _build_regex(pattern, flags)
    hits: list[GrepHit] = []
    truncated = False

    for filename, source in sorted(artifact_sources.items()):
        if not is_frontend_artifact_name(filename):
            continue
        if not fnmatch.fnmatchcase(filename, name_glob):
            continue

        # Walk lines once, scan each for matches; report first match per line
        # to keep output dense.
        offset = 0
        for line_no, line in enumerate(source.splitlines(keepends=False), start=1):
            line_len = len(line)
            m = regex.search(line)
            if m is not None:
                hits.append(
                    GrepHit(
                        filename=filename,
                        line_no=line_no,
                        line=line,
                        byte_offset=offset + m.start(),
                    )
                )
                if len(hits) >= max_results:
                    truncated = True
                    return hits, truncated
            # +1 for the newline that splitlines stripped
            offset += line_len + 1

    return hits, truncated


# --------------------------------------------------------------------------- #
# Edit — apply_edit_to_artifact
# --------------------------------------------------------------------------- #


@dataclass
class EditResult:
    ok: bool
    new_source: str
    edits_applied: int
    error: str | None = None


def apply_edit_to_artifact(
    source: str,
    old_string: str,
    new_string: str,
    *,
    replace_all: bool = False,
) -> EditResult:
    """Surgical string replace inside ``source``.

    ``replace_all=False`` requires ``old_string`` to be unique in the
    file; returns an error with the match count otherwise.

    Returns the spliced source — caller is responsible for running the
    full validation pipeline (esbuild → tsc → AST → fixers → semantic →
    style coverage) on the result before persisting it.
    """
    if not old_string:
        return EditResult(
            ok=False,
            new_source=source,
            edits_applied=0,
            error="old_string must not be empty.",
        )

    if old_string == new_string:
        return EditResult(
            ok=False,
            new_source=source,
            edits_applied=0,
            error="old_string and new_string are identical — no edit to apply.",
        )

    occurrences = source.count(old_string)
    if occurrences == 0:
        return EditResult(
            ok=False,
            new_source=source,
            edits_applied=0,
            error=(
                f"old_string not found in artifact. Re-read the file with "
                f"load_artifacts and copy the exact text including whitespace."
            ),
        )

    if not replace_all and occurrences > 1:
        return EditResult(
            ok=False,
            new_source=source,
            edits_applied=0,
            error=(
                f"old_string is not unique — matched {occurrences} times. "
                f"Either provide a longer surrounding context to make it "
                f"unique, or set replace_all=True to replace every match."
            ),
        )

    if replace_all:
        new_source = source.replace(old_string, new_string)
        return EditResult(ok=True, new_source=new_source, edits_applied=occurrences)

    new_source = source.replace(old_string, new_string, 1)
    return EditResult(ok=True, new_source=new_source, edits_applied=1)
