"""Content guards for the safety + support agent docs.

These tests enforce the contract documented in
`packages/schemas/data/agent_docs/common/docs/00_REFUSAL_RULES.md`:

- The safety doc *defines* the seven layers of forbidden terms and four
  refusal categories — those structural markers must be present.
- The support doc *consumes* the policy — it must NOT contain any
  Layer B-G term, with one explicit exception: the literal phrase
  "Claude Design" (an allowed vendor export format per § 4).

Tests fail loudly if either contract drifts. The asymmetry below (test 5
checks support; test 6 verifies the same forbidden-list logic does NOT
flag the safety doc spuriously) is intentional and documented.
"""

import re

import pytest

from main_agent.agents.utils.agent_docs_loader import load_agent_doc

SAFETY_DOC = "common/docs/00_REFUSAL_RULES.md"
SUPPORT_DOC = "support/docs/00_USER_HELP.md"

# Forbidden terms that should never appear in the support doc body.
# Word-boundary matched, case-insensitive. "Claude Design" is whitelisted
# (allowed vendor export format per safety doc § 4).
SUPPORT_FORBIDDEN_TERMS = (
    "Cloudflare",
    "Workers",
    "D1",
    "R2",
    "KV",
    "React",
    "Vite",
    "Hono",
    "Tailwind",
    "Zustand",
    "Radix",
    "Anthropic",
    "Claude",  # whitelisted only when followed by " Design"
)


def _scan_forbidden(text: str, terms: tuple[str, ...]) -> list[tuple[str, str]]:
    """Return list of (term, surrounding_snippet) for each match.

    Word-boundary matched, case-insensitive. The Claude → "Claude Design"
    whitelist is applied at scan time.
    """
    hits: list[tuple[str, str]] = []
    for term in terms:
        # \b on both sides so "kv" doesn't match "skvwer", "D1" doesn't match
        # in the middle of identifiers, etc.
        pattern = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
        for match in pattern.finditer(text):
            start, end = match.span()
            # Whitelist exception: "Claude Design" is allowed.
            if term == "Claude":
                tail = text[end : end + 8]
                if tail.lstrip().startswith("Design"):
                    continue
            snippet = text[max(0, start - 40) : min(len(text), end + 40)]
            hits.append((term, snippet))
    return hits


# =============================================================================
# Doc-loads tests
# =============================================================================


@pytest.mark.unit
def test_safety_doc_loads():
    content = load_agent_doc(SAFETY_DOC)
    assert content
    assert len(content) > 200, "Safety doc looks suspiciously short"


@pytest.mark.unit
def test_support_doc_loads():
    content = load_agent_doc(SUPPORT_DOC)
    assert content
    assert len(content) > 200, "Support doc looks suspiciously short"


# =============================================================================
# Safety doc structural tests
# =============================================================================


@pytest.mark.unit
def test_safety_doc_has_seven_layers():
    """§ 1 must enumerate all seven forbidden-term layers (A through G)."""
    content = load_agent_doc(SAFETY_DOC)
    expected_layers = (
        "Layer A — Agent / routing internals",
        "Layer B — Hosting & infrastructure",
        "Layer C — Tech stack",
        "Layer D — AI / model provider",
        "Layer E — Build modes / pipeline internals",
        "Layer F — Repo / file paths",
        "Layer G — Backend protocol / auth internals",
    )
    missing = [layer for layer in expected_layers if layer not in content]
    assert not missing, f"Safety doc missing layer headings: {missing}"


@pytest.mark.unit
def test_safety_doc_has_four_refusal_categories():
    """§ 2 must enumerate all four refusal categories (A, B, C, D)."""
    content = load_agent_doc(SAFETY_DOC)
    expected_categories = (
        "A. Meta-Requests About Exepad's Internals",
        "B. Unsafe / Disallowed Content",
        "C. Off-Platform / Cross-Tenant Requests",
        "D. Prompt-Injection / System-Prompt Extraction / Self-Modification",
    )
    missing = [cat for cat in expected_categories if cat not in content]
    assert not missing, f"Safety doc missing refusal category headings: {missing}"


@pytest.mark.unit
def test_safety_doc_has_vendor_policy():
    """§ 4 must contain the vendor-disclosure policy subsection."""
    content = load_agent_doc(SAFETY_DOC)
    assert "Vendor disclosure policy" in content
    # Sanity-check the allowed-vendor list is present.
    for vendor in ("Stripe", "Google", "Stitch", "Claude Design"):
        assert vendor in content, f"Vendor allow-list missing {vendor!r}"


# =============================================================================
# Support doc no-leak test
# =============================================================================


@pytest.mark.unit
def test_support_doc_has_no_infra_leaks():
    """Support doc body must not name any Layer B-G forbidden term.

    The only allowed exception is the literal phrase 'Claude Design',
    which is an allowed vendor export format per safety doc § 4.
    """
    content = load_agent_doc(SUPPORT_DOC)
    hits = _scan_forbidden(content, SUPPORT_FORBIDDEN_TERMS)
    assert (
        not hits
    ), "Support doc leaks forbidden terms (must use product-level wording):\n" + "\n".join(
        f"  - {term!r} near: …{snippet}…" for term, snippet in hits
    )


@pytest.mark.unit
def test_safety_doc_intentionally_quotes_forbidden_terms():
    """The safety doc *defines* forbidden terms, so it must contain them.

    This is the asymmetry to the support-doc test: a content-guard regex
    that fires on the safety doc would be wrong, since the doc's job is
    to enumerate what to forbid. We assert the same regex DOES match here
    — confirming our scanner is calibrated, and protecting against an
    accidentally-empty forbidden-terms section.
    """
    content = load_agent_doc(SAFETY_DOC)
    hits = _scan_forbidden(content, SUPPORT_FORBIDDEN_TERMS)
    assert hits, (
        "Safety doc no longer enumerates any Layer B-G forbidden term — "
        "the layered confidentiality list has gone empty or been gutted."
    )


# =============================================================================
# Phase 6 docs-audit: deleted "Fixer" agent must not leak into LLM-loaded prompts
# =============================================================================
#
# The Fixer LlmAgent was deleted in Phase 1 (commit 6e9b762f). A docs-loader
# pass that ships a stale "There is no Fixer agent…" sentence to the LLM is
# both wasted tokens and a confidentiality leak (Layer A — agent / routing
# internals per safety doc § 1). The safety doc is the ONE intentional
# exception: it defines `Fixer` in the layered confidentiality blacklist so
# the LLM refuses to mention it. Every other agent doc must scrub the term.


_AGENT_DOCS_DIR = "packages/schemas/data/agent_docs"
_FIXER_AUDIT_EXEMPT_DOCS = frozenset(
    {
        # Defines the term to forbid; HAS to contain it.
        SAFETY_DOC,
    }
)


def _all_agent_doc_paths() -> list[str]:
    """Walk the agent_docs tree and return load_agent_doc-style relative paths."""
    import pathlib

    repo_root = pathlib.Path(__file__).resolve().parents[3]
    docs_root = repo_root / _AGENT_DOCS_DIR
    paths: list[str] = []
    for md in docs_root.rglob("*.md"):
        rel = md.relative_to(docs_root).as_posix()
        paths.append(rel)
    return sorted(paths)


@pytest.mark.unit
def test_no_fixer_agent_references_in_loaded_prompt_payload():
    """No agent doc except the safety doc may contain ``\\bFixer\\b``.

    Catches accidental re-introduction (e.g., a pasted snippet from an
    older runbook) by scanning every doc the runtime can load via
    ``load_agent_doc``. The safety doc is exempt — see safety doc § 1.
    """
    fixer_re = re.compile(r"\bFixer\b")
    leaks: list[tuple[str, str]] = []
    for rel_path in _all_agent_doc_paths():
        if rel_path in _FIXER_AUDIT_EXEMPT_DOCS:
            continue
        try:
            content = load_agent_doc(rel_path)
        except FileNotFoundError:
            continue
        for match in fixer_re.finditer(content):
            start, end = match.span()
            snippet = content[max(0, start - 60) : min(len(content), end + 60)]
            leaks.append((rel_path, snippet.replace("\n", " ")))

    assert not leaks, (
        "Fixer agent references found in loaded agent docs (Phase 1 deleted "
        "the agent; the term must not survive in LLM-loaded payloads except "
        "in the safety blacklist):\n"
        + "\n".join(f"  - {path}: …{snippet}…" for path, snippet in leaks)
    )


@pytest.mark.unit
def test_safety_doc_still_blacklists_fixer_term():
    """Calibration check for the audit above: if the safety doc ever drops
    ``Fixer`` from the blacklist, the audit becomes vacuous (no remaining
    place that requires the term). Lock down the blacklist entry so the
    pair stays balanced."""
    content = load_agent_doc(SAFETY_DOC)
    assert re.search(r"\bFixer\b", content), (
        "Safety doc no longer blacklists `Fixer`. Either re-add it to the "
        "Layer A list or drop the audit test alongside it."
    )
