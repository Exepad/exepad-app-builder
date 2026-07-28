"""End-to-end parity guarantee — the original Onix Studio bug stays fixed.

Combines the mechanical pipeline (Phases 1-5) with the parity
validator (Phase 6) to prove the original LLM-driven hallucinated
output would be hard-blocked from saving.

This is the explicit regression test for the live Onix bug at
``https://p1.exepad.com/a/preview-8mtmbi4y/``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from main_agent.agents.orchestrator.importers.tools.html_to_tsx import (
    transform_html_to_tsx,
)
from main_agent.services.validation.design_import_parity import check_parity

pytestmark = [pytest.mark.integration]

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def test_onix_llm_hallucination_blocked_by_parity_validator():
    """Simulate the actual Onix bug end-to-end.

    1. Mechanical pipeline transforms the source HTML to TSX
       (the legitimate baseline).
    2. Construct a synthetic "LLM-edited" TSX that mirrors the actual
       Onix bug: client names fabricated, team renamed, sections
       added, href stripped.
    3. Parity validator runs against the baseline + synthetic LLM
       output. MUST emit violations covering every category of
       hallucination.
    """
    html = (FIXTURES_DIR / "onix_studio_page.html").read_text(encoding="utf-8")
    mechanical = transform_html_to_tsx(
        html,
        component_name="HomeContent",
        component_role="content",
        page_slugs=("/",),
        form_ids=("brief",),
    )
    baseline = mechanical.tsx

    # Synthesize the LLM-driven hallucinated output (what the actual
    # ComponentBuilder LLM produced for the live Onix bug).
    hallucinated = baseline
    # Replace original team-member names with fabrications
    hallucinated = hallucinated.replace("Maya Chen", "Elena Rossi")
    hallucinated = hallucinated.replace("Jonas Albrecht", "Marcus Chen")
    hallucinated = hallucinated.replace("Adaeze Okafor", "Sarah Jenkins")
    # Replace the client name
    hallucinated = hallucinated.replace("North-American freight carrier", "Astra Finance")
    # Strip the contact-form CTA href
    hallucinated = hallucinated.replace('<a className="cta" href="#contact"', '<a className="cta"')
    # Add a "Closing CTA" section that doesn't exist in source
    hallucinated += "\n<section><h2>Ready to evolve?</h2></section>\n"

    result = check_parity(
        before_tsx=baseline,
        after_tsx=hallucinated,
        backend_surface=None,
    )

    assert not result.passed, (
        "Parity validator failed to catch the Onix LLM hallucination — "
        "this is the exact failure the entire pipeline was built to prevent."
    )

    codes = sorted({v.code for v in result.violations})
    # Each Onix bug surface manifests as a distinct violation code
    assert (
        "text_drift" in codes
    ), "Fabricated names (Maya Chen → Elena Rossi) should produce text_drift"
    assert (
        "structural_tag_drift" in codes
    ), "The added 'Closing CTA' section should produce structural_tag_drift"
    # Removed href is an optional catch — the Onix LLM stripped href,
    # but the parity check sees the contact CTA still has its label.
    # (the regex pattern matched the original `<a href="#contact" class="cta">`
    # which has no Link replacement in the output)
    assert "removed_href" in codes


def test_mechanical_baseline_passes_against_itself():
    """Sanity: a mechanical TSX matched against itself has zero violations."""
    html = (FIXTURES_DIR / "onix_studio_page.html").read_text(encoding="utf-8")
    mechanical = transform_html_to_tsx(html, component_name="HomeContent")
    result = check_parity(
        before_tsx=mechanical.tsx,
        after_tsx=mechanical.tsx,
        backend_surface=None,
    )
    assert result.passed, (
        f"Mechanical TSX should pass parity against itself. "
        f"Violations: {[(v.code, v.message[:60]) for v in result.violations]}"
    )


def test_legitimate_componentbuilder_edit_passes_parity():
    """A reasonable ComponentBuilder edit (added hooks + onClick) passes parity."""
    html = (FIXTURES_DIR / "onix_studio_page.html").read_text(encoding="utf-8")
    mechanical = transform_html_to_tsx(html, component_name="HomeContent")
    baseline = mechanical.tsx

    # Simulate what ComponentBuilder edit mode might do: add a useState
    # hook + onClick to a button. No structural changes, no text changes.
    edited = baseline.replace(
        "function HomeContent() {",
        "function HomeContent() {\n  const [open, setOpen] = React.useState(false);",
        1,
    )
    edited = edited.replace(
        '<button className="submit"',
        '<button className="submit" onClick={() => setOpen(true)}',
        1,
    )

    result = check_parity(
        before_tsx=baseline,
        after_tsx=edited,
        backend_surface=None,
    )
    assert result.passed, (
        f"Legitimate edit was incorrectly flagged: "
        f"{[(v.code, v.message[:60]) for v in result.violations]}"
    )
