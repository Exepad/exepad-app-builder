"""Unit tests for ``main_agent.services.validation.dirty_file_sweeper``.

Covers Tier 1 (revalidate_importers), Tier 2 (sweep_dirty_files), and
the fix-up prompt renderer.

Fixture: a Card module + Page component pair where Card.label has been
renamed to Card.title; Page still passes label= and references a
function that no longer exists (semantic-detectable cascade).
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.dirty_file_sweeper import (
    DirtyFileIssue,
    render_fix_up_prompt,
    revalidate_importers,
    sweep_dirty_files,
)

pytestmark = [pytest.mark.unit]


# A Page that imports Card and references a JSX identifier ``Button``
# that is never defined or imported. The semantic engine's
# ``JsxUndeclaredReferenceRule`` flags this regardless of Card's surface,
# so the test is robust across rule-set tweaks.
# Page imports Card from a relative module. The broken variant uses
# the SDK component <Button> in JSX *without* adding it to the
# @exepad/sdk import — that's a hard semantic error caught by
# ``component.imports.missing_sdk_export``. The clean variant imports
# Button correctly.
# Broken Page contains a placeholder-div pattern that the semantic
# engine flags as an error and which auto-fixers do NOT rewrite.
PAGE_TSX_BROKEN = (
    'import { React } from "@exepad/sdk";\n'
    'import { LABELS } from "./DataLib";\n'
    'export default function Page() {\n'
    '  return (<div>{LABELS[0]}'
    '<div className="bg-gray-200 flex items-center justify-center">'
    '<span className="text-gray-500">Map placeholder</span></div></div>);\n'
    '}\n'
)

PAGE_TSX_CLEAN = (
    'import { React } from "@exepad/sdk";\n'
    'import { LABELS } from "./DataLib";\n'
    'export default function Page() {\n'
    '  return <div>{LABELS[0]}</div>;\n'
    '}\n'
)

DATALIB_TSX = (
    'export const LABELS = ["a", "b", "c"];\n'
)


@pytest.fixture
def broken_sources() -> dict[str, str]:
    return {
        "codefocus_module:DataLib.tsx": DATALIB_TSX,
        "codefocus_component:Page.tsx": PAGE_TSX_BROKEN,
    }


@pytest.fixture
def clean_sources() -> dict[str, str]:
    return {
        "codefocus_module:DataLib.tsx": DATALIB_TSX,
        "codefocus_component:Page.tsx": PAGE_TSX_CLEAN,
    }


class TestRevalidateImporters:
    async def test_finds_issue_in_importer(self, broken_sources):
        issues = await revalidate_importers(
            "codefocus_module:DataLib.tsx",
            broken_sources,
        )
        assert issues, "expected at least one Tier-1 issue on broken Page importer"
        files = {i.filename for i in issues}
        assert "codefocus_component:Page.tsx" in files
        # The undeclared ``Button`` reference must be flagged.
        assert any("placeholder div" in i.message for i in issues), (
            f"expected placeholder issue, got: {[i.message for i in issues]}"
        )

    async def test_clean_importer_does_not_flag_ghosthandler(self, clean_sources):
        issues = await revalidate_importers(
            "codefocus_module:DataLib.tsx",
            clean_sources,
        )
        # The clean Page must not trip the placeholder cascade.
        assert not any("placeholder div" in i.message for i in issues)

    async def test_skip_self_default(self, broken_sources):
        # Saved file should never appear in the issue list when skip_self=True.
        issues = await revalidate_importers(
            "codefocus_module:DataLib.tsx",
            broken_sources,
        )
        assert all(i.filename != "codefocus_module:DataLib.tsx" for i in issues)

    async def test_skips_already_saved_this_turn(self, broken_sources):
        issues = await revalidate_importers(
            "codefocus_module:DataLib.tsx",
            broken_sources,
            already_saved_this_turn={"codefocus_component:Page.tsx"},
        )
        # Page was already saved this turn, so it's skipped.
        assert all(
            i.filename != "codefocus_component:Page.tsx" for i in issues
        )

    async def test_unknown_saved_file(self):
        issues = await revalidate_importers(
            "codefocus_module:DoesNotExist.tsx",
            {},
        )
        assert issues == []


class TestSweepDirtyFiles:
    async def test_sweep_finds_broken_page(self, broken_sources):
        issues = await sweep_dirty_files(
            ["codefocus_module:DataLib.tsx"],
            broken_sources,
        )
        # Expansion to importers should pull Page.tsx in.
        assert "codefocus_component:Page.tsx" in issues
        page_issues = issues["codefocus_component:Page.tsx"]
        assert any("placeholder div" in i.message for i in page_issues)

    async def test_sweep_clean_set_no_ghost(self, clean_sources):
        issues = await sweep_dirty_files(
            ["codefocus_module:DataLib.tsx"],
            clean_sources,
        )
        # Clean sweep must not surface the placeholder cascade.
        for file_issues in issues.values():
            assert not any("placeholder div" in i.message for i in file_issues)

    async def test_sweep_no_expansion(self, broken_sources):
        issues = await sweep_dirty_files(
            ["codefocus_module:DataLib.tsx"],
            broken_sources,
            expand_to_importers=False,
        )
        # Without expansion, Page.tsx is not in the dirty set.
        assert "codefocus_component:Page.tsx" not in issues


class TestRenderFixUpPrompt:
    def test_emits_error_files_omits_warning_only_files(self):
        """Files with errors are listed; files with only warnings are
        dropped from the prompt entirely (ckfk4mun 2026-05-18 — the polish
        loop iterated on persistent <button> warnings the LLM couldn't
        fix without a backend handler, burning 45 tool calls). Errors are
        still emitted; warnings are deliberately omitted from the LLM
        prompt body but remain visible in logs."""
        issues = {
            "codefocus_component:Page.tsx": [
                DirtyFileIssue(
                    filename="codefocus_component:Page.tsx",
                    rule="semantic",
                    line=4,
                    message="Button is undefined",
                ),
            ],
            "codefocus_module:DataLib.tsx": [
                DirtyFileIssue(
                    filename="codefocus_module:DataLib.tsx",
                    rule="style_coverage",
                    line=None,
                    message="bg-foo missing token",
                    severity="warning",
                ),
            ],
        }
        rendered = render_fix_up_prompt("Original goal text.", issues)
        assert "Original goal text." in rendered
        # Error-bearing file is listed:
        assert "codefocus_component:Page.tsx" in rendered
        assert "Button" in rendered
        assert "FIX-UP PASS" in rendered
        # Warning-only file is omitted entirely (filename + message both):
        assert "codefocus_module:DataLib.tsx" not in rendered
        assert "bg-foo" not in rendered
        # Header is errors-only — no "Warnings:" subsection:
        assert "Warnings:" not in rendered

    def test_warning_only_issues_return_original_prompt(self):
        """If every dirty file has only warning-level findings, the prompt
        is returned unchanged — there is nothing for the LLM to fix that
        would survive validation gating."""
        issues = {
            "codefocus_component:Page.tsx": [
                DirtyFileIssue(
                    filename="codefocus_component:Page.tsx",
                    rule="a11y_ux",
                    line=12,
                    message="<button> labelled 'Submit' has no onClick / href / type='submit' binding",
                    severity="warning",
                ),
            ],
        }
        rendered = render_fix_up_prompt("Original prompt.", issues)
        assert rendered == "Original prompt."

    def test_mixed_errors_and_warnings_same_file_emits_errors_only(self):
        """A file with both errors AND warnings appears in the prompt,
        but the warnings are dropped from its issue list — the LLM sees
        only the actionable errors."""
        issues = {
            "codefocus_component:Page.tsx": [
                DirtyFileIssue(
                    filename="codefocus_component:Page.tsx",
                    rule="semantic",
                    line=4,
                    message="Button is undefined",
                ),
                DirtyFileIssue(
                    filename="codefocus_component:Page.tsx",
                    rule="a11y_ux",
                    line=20,
                    message="<button> has no onClick binding",
                    severity="warning",
                ),
            ],
        }
        rendered = render_fix_up_prompt("Goal.", issues)
        assert "codefocus_component:Page.tsx" in rendered
        assert "Button is undefined" in rendered
        # Warning text is NOT propagated to the prompt:
        assert "<button> has no onClick binding" not in rendered
        assert "Warnings:" not in rendered

    def test_empty_issues_returns_original(self):
        rendered = render_fix_up_prompt("orig", {})
        assert rendered == "orig"
