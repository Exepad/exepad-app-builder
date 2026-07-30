"""End-to-end content-fidelity check for the mechanical pipeline.

Path B (static design import — Onix Studio is the canonical example).
Runs the transformer against the real cleaned HTML the decomposition
runner produced for the live Onix Studio bug, then asserts:

* Every fabricated string from the live LLM-driven app is ABSENT
  from the mechanical output.
* Every original source string the LLM dropped is PRESENT in the
  mechanical output, byte-faithfully.
* Element counts match the source (4 case studies stay 4, 6 team
  members stay 6, 5 manifesto tenets stay 5, 6 sections stay 6).
* The behavioral JS is extracted to the sidecar.
* The mechanical pipeline emits zero plan items for static imports
  (no backend declared) and zero warnings.

This is the regression test for the original Onix Studio bug at
``https://p1.exepad.com/a/preview-8mtmbi4y/`` — the LLM-driven app
that hallucinated client names, dropped team members, added a
"Closing CTA" section, and stripped href attributes.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from main_agent.agents.orchestrator.importers.tools.html_to_tsx import (
    transform_html_to_tsx,
)

pytestmark = [pytest.mark.integration]

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(scope="module")
def onix_page_result():
    html = (FIXTURES_DIR / "onix_studio_page.html").read_text(encoding="utf-8")
    return transform_html_to_tsx(
        html,
        component_name="HomeContent",
        component_role="content",
        page_slugs=("/",),
        form_ids=("brief",),
        backend_surface=None,
        building_plan=[],
    )


@pytest.fixture(scope="module")
def onix_header_result():
    html = (FIXTURES_DIR / "onix_studio_header.html").read_text(encoding="utf-8")
    return transform_html_to_tsx(
        html,
        component_name="MainHeader",
        component_role="header",
        page_slugs=("/",),
    )


@pytest.fixture(scope="module")
def onix_footer_result():
    html = (FIXTURES_DIR / "onix_studio_footer.html").read_text(encoding="utf-8")
    return transform_html_to_tsx(
        html,
        component_name="MainFooter",
        component_role="footer",
        page_slugs=("/",),
    )


# ---------------------------------------------------------------------------
# Hallucinated strings from the live Onix bug — MUST NOT appear in mechanical
# output.
# ---------------------------------------------------------------------------

ONIX_FABRICATIONS = [
    "Astra Finance",
    "Vektor Logistics",
    "Kora Health",
    "Elena Rossi",
    "Marcus Chen",
    "Sarah Jenkins",
    "First Principles",
    "Open-Sovereignty",
    "Initialize Intake",
    "build the future",
    "The Architects",
    "Inference Architecture",
    "Neural Reasoning",
    "Synthetic Datasets",
    "Model Alignment",
]


# ---------------------------------------------------------------------------
# Original source strings the LLM dropped — MUST appear in mechanical output.
# ---------------------------------------------------------------------------

ONIX_PRESERVED_TITLES = [
    # Source has <em> markup splitting the title text — match the
    # un-emphasised prefix only.
    "Things we built that",
    "are still running.",
    "Five things we will",
    "not stop saying.",
    "Six people.",
    "No headshots.",
    "Tell us",
    "what's broken,",
    "We don",  # "We don't ship demos. We ship systems with on-call rotations."
]

ONIX_TEAM_NAMES = [
    "Maya Chen",
    "Jonas Albrecht",
    "Adaeze Okafor",
    "Henrik S",  # "Henrik Sørensen" — match prefix to dodge encoding issues
    "Priya Ranganathan",
    "Tom",  # "Tomás Reyes" — same reason
]

ONIX_CLIENTS = [
    "North-American freight carrier",
    # "Series C consumer fintech" in source has U+00A0 (non-breaking
    # space) between "Series" and "C" (rendered as ``&nbsp;`` in HTML).
    # BeautifulSoup decodes &nbsp; to U+00A0 verbatim — the text node
    # survives byte-faithfully. The test asserts the post-nbsp portion
    # which is unambiguous.
    "consumer fintech",
    "Top-10 pharma",
    "Industrial OEM",
]


def test_onix_homecontent_no_fabrications(onix_page_result):
    """No hallucinated strings appear in the mechanical TSX."""
    for fabrication in ONIX_FABRICATIONS:
        assert fabrication not in onix_page_result.tsx, (
            f"Hallucination {fabrication!r} found in mechanical TSX. "
            "This is the exact failure mode that motivated the entire pipeline."
        )


def test_onix_homecontent_titles_preserved(onix_page_result):
    """Original section titles survive verbatim."""
    for needle in ONIX_PRESERVED_TITLES:
        assert (
            needle in onix_page_result.tsx
        ), f"Original source title {needle!r} missing from mechanical TSX"


def test_onix_homecontent_team_preserved(onix_page_result):
    """All 6 team-member names survive verbatim."""
    for name in ONIX_TEAM_NAMES:
        assert (
            name in onix_page_result.tsx
        ), f"Original team-member name {name!r} missing from mechanical TSX"


def test_onix_homecontent_clients_preserved(onix_page_result):
    """All 4 case-study clients survive verbatim."""
    for client in ONIX_CLIENTS:
        assert (
            client in onix_page_result.tsx
        ), f"Original client name {client!r} missing from mechanical TSX"


def test_onix_homecontent_element_counts(onix_page_result):
    """Section / case-study / tenet / team / capability counts match source."""
    tsx = onix_page_result.tsx
    # Source has 6 <section> blocks (hero, work, capabilities, approach,
    # team, contact). Mechanical output preserves them.
    assert tsx.count("<section") == 6, f"Expected 6 <section> tags, got {tsx.count('<section')}"
    # 4 case-study anchors with the ``work`` className
    assert tsx.count('className="work reveal"') == 4
    # 4 capability divs
    assert tsx.count('className="cap"') == 4
    # 5 manifesto tenets
    assert tsx.count('className="tenet"') == 5
    # 6 team-member divs
    assert tsx.count('className="person"') == 6
    # 1 contact form
    assert tsx.count("<form ") == 1


def test_onix_homecontent_scripts_extracted(onix_page_result):
    """Behavioral JS is non-empty; source had nav scroll, IO, magnetic-CTA, etc."""
    assert onix_page_result.scripts_js, "Onix scripts should be extracted to sidecar"
    assert "addEventListener" in onix_page_result.scripts_js
    assert "IntersectionObserver" in onix_page_result.scripts_js


def test_onix_homecontent_no_styles_sidecar(onix_page_result):
    """Decomposition runner strips <style> upstream — sidecar should be empty."""
    assert onix_page_result.styles_css == ""


def test_onix_homecontent_high_confidence(onix_page_result):
    """Source is well-formed → confidence high, no fallback to LLM."""
    assert onix_page_result.confidence == "high"
    assert onix_page_result.warnings == []


def test_onix_homecontent_path_b_only_behavioral_plan_item(onix_page_result):
    """Path B (no backend declared) — only the BEHAVIORAL residual plan
    item fires.

    Onix's source JS has ``form.replaceWith(success)`` and
    ``success.innerHTML = ...`` — DOM mutations the useEffect-wrap
    can't safely handle. Phase 5's behavioral-residual detector fires
    REGARDLESS of backend_surface (the mutation needs React state
    either way). No wiring plan items because no backend was declared.
    """
    assert len(onix_page_result.plan_items) == 1, (
        f"Expected exactly 1 plan item (BEHAVIORAL only). Got "
        f"{len(onix_page_result.plan_items)}: {onix_page_result.plan_items}"
    )
    item = onix_page_result.plan_items[0]
    assert item.startswith("BEHAVIORAL"), f"Expected BEHAVIORAL plan item, got: {item[:80]}"
    assert "replaceWith" in item
    assert "innerHTML" in item
    assert "design_import_scripts:HomeContent.js" in item


def test_onix_homecontent_useeffect_wraps_scripts(onix_page_result):
    """Phase 3 wraps the extracted JS in a single useEffect block."""
    assert "React.useEffect(() => {" in onix_page_result.tsx
    assert "}, []);" in onix_page_result.tsx
    # Cleanup synthesis: nav scroll listener + sigCanvas RAF loop
    assert "removeEventListener" in onix_page_result.tsx
    assert "cancelAnimationFrame" in onix_page_result.tsx


def test_onix_header_mobile_nav_scaffold(onix_header_result):
    """Phase 4 injects mobile-nav scaffold for header components with <nav>."""
    tsx = onix_header_result.tsx
    assert "isMobileMenuOpen" in tsx, "Mobile-nav scaffold not injected for Onix MainHeader"
    assert "Icons.Menu" in tsx
    assert "Icons.X" in tsx
    assert "fixed inset-0 z-[60]" in tsx
    assert "hidden lg:flex" in tsx


def test_onix_header_imports_compose_correctly(onix_header_result):
    """Header import line includes Icons (mobile nav) and Link (internal anchor)."""
    first_line = onix_header_result.tsx.split("\n", 1)[0]
    for needed in ("React", "LightDOMContainer", "Icons"):
        assert needed in first_line, f"Header import line missing {needed!r}: {first_line!r}"


def test_onix_footer_no_mobile_nav_scaffold(onix_footer_result):
    """Phase 4 only fires for component_role='header'; footer skipped."""
    assert (
        "isMobileMenuOpen" not in onix_footer_result.tsx
    ), "Footer should not get mobile-nav scaffold"
