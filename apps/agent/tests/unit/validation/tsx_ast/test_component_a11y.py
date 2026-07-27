"""Unit tests for the a11y component rules."""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_a11y import (
    ButtonAriaLabelRule,
    DialogDescriptionRule,
    HeadingOrderRule,
)


def _run(rule, tsx: str):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return [(f.severity, f.message) for f in run_rules(ctx, [rule])]


class TestHeadingOrderRule:
    def test_sequential_passes(self):
        tsx = "<div><h1>T</h1><h2>S</h2><h3>Sub</h3></div>"
        assert _run(HeadingOrderRule(), tsx) == []

    def test_two_h2_sections_pass(self):
        tsx = "<div><h2>A</h2><h2>B</h2></div>"
        assert _run(HeadingOrderRule(), tsx) == []

    def test_single_level_skip_is_warning(self):
        tsx = "<div><h1>T</h1><h3>Skipped h2</h3></div>"
        results = _run(HeadingOrderRule(), tsx)
        assert len(results) == 1
        assert results[0][0] == "warning"
        assert "jumped from h1 to h3" in results[0][1]

    def test_double_level_skip_is_error(self):
        tsx = "<div><h1>T</h1><h4>Deep</h4></div>"
        results = _run(HeadingOrderRule(), tsx)
        assert any(sev == "error" and "h1 to h4" in msg for sev, msg in results)

    def test_starts_at_h3_flagged(self):
        tsx = "<div><h3>First</h3></div>"
        results = _run(HeadingOrderRule(), tsx)
        assert any("first heading is h3" in msg for _, msg in results)

    def test_ascending_back_up_allowed(self):
        tsx = "<div><h1>T</h1><h2>A</h2><h3>A1</h3><h2>B</h2><h3>B1</h3></div>"
        assert _run(HeadingOrderRule(), tsx) == []


class TestButtonAriaLabelRule:
    def test_button_with_text_passes(self):
        tsx = "<Button onClick={h}>Submit</Button>"
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_aria_label_passes(self):
        tsx = '<Button aria-label="Submit"><Icons.Send/></Button>'
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_title_attr_passes(self):
        tsx = '<Button title="Close"><Icons.X/></Button>'
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_icon_only_button_flagged(self):
        tsx = "<Button onClick={h}><Icons.Send/></Button>"
        results = _run(ButtonAriaLabelRule(), tsx)
        assert len(results) == 1
        assert "Icon-only <Button>" in results[0][1]

    def test_self_closing_icon_button_flagged(self):
        tsx = "<IconButton onClick={h}/>"
        results = _run(ButtonAriaLabelRule(), tsx)
        assert len(results) == 1
        assert "Icon-only <IconButton/>" in results[0][1]

    def test_lowercase_button_flagged(self):
        tsx = "<button onClick={h}><Icons.X/></button>"
        results = _run(ButtonAriaLabelRule(), tsx)
        assert len(results) == 1

    # ── jsx_expression as visible text (regression: ChevronRight injection) ──

    def test_identifier_expression_text_passes(self):
        """``<button>{filter}</button>`` is NOT icon-only — the
        identifier renders as text. Was incorrectly flagged before the
        ``_element_has_visible_text`` fix that taught it about
        jsx_expression children."""
        tsx = "<button onClick={h}>{filter}</button>"
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_member_expression_text_with_trailing_icon_passes(self):
        """The exact MainHeader pattern that produced ``aria-label="ChevronRight"``:
        a navigation button whose visible text is ``{link.label}`` with a
        decorative trailing icon."""
        tsx = (
            "<button onClick={h}>"
            "{link.label}"
            "<Icons.ChevronRight/>"
            "</button>"
        )
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_ternary_text_passes(self):
        """``<Button>{submitting ? "Joining..." : "Join Now"}</Button>``
        from MainFooter — ternary yields renderable text."""
        tsx = (
            "<Button type=\"submit\">"
            '{submitting ? "Joining..." : "Join Now"}'
            "</Button>"
        )
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_decorative_jsx_in_expression_still_flagged(self):
        """``{<Icon/>}`` is decorative, not text. Buttons whose only
        children are JSX-in-expressions must remain flagged as icon-only."""
        tsx = "<button onClick={h}>{<Icons.X/>}</button>"
        results = _run(ButtonAriaLabelRule(), tsx)
        assert len(results) == 1

    def test_conditional_jsx_still_flagged(self):
        """``{showIcon && <Icon/>}`` is decorative — the binary_expression
        operand is a JSX element, so the whole expression yields no text.
        Button is correctly flagged as icon-only."""
        tsx = "<button onClick={h}>{showIcon && <Icons.X/>}</button>"
        results = _run(ButtonAriaLabelRule(), tsx)
        assert len(results) == 1

    def test_binary_string_concat_is_text(self):
        """``{prefix + " more"}`` yields renderable text — every operand
        is non-JSX."""
        tsx = '<button onClick={h}>{prefix + " label"}</button>'
        assert _run(ButtonAriaLabelRule(), tsx) == []

    # ── anchors (link-name) ──────────────────────────────────────────────

    def test_icon_only_anchor_flagged(self):
        """``<a href="#"><Icons.Twitter/></a>`` is an icon-only link with
        no accessible name — the axe ``link-name`` failure."""
        tsx = '<a href="#"><Icons.Twitter/></a>'
        results = _run(ButtonAriaLabelRule(), tsx)
        assert len(results) == 1
        assert "<a> link" in results[0][1]

    def test_text_anchor_passes(self):
        tsx = '<a href="/about">About</a>'
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_anchor_aria_label_passes(self):
        tsx = '<a href="#" aria-label="Open Twitter"><Icons.Twitter/></a>'
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_anchor_sr_only_text_passes(self):
        """An sr-only <span> provides a screen-reader-only accessible name."""
        tsx = '<a href="#"><span className="sr-only">Twitter</span><Icons.Twitter/></a>'
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_logo_image_link_passes(self):
        """``<a href="/"><img alt="Acme"/></a>`` borrows the image's alt
        text — must NOT be flagged as icon-only."""
        tsx = '<a href="/"><img alt="Acme" src="/logo.svg"/></a>'
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_dynamic_alt_image_link_passes(self):
        tsx = '<a href="/"><img alt={brand} src={logo}/></a>'
        assert _run(ButtonAriaLabelRule(), tsx) == []

    def test_empty_alt_image_link_flagged(self):
        """``alt=""`` is decorative — the link still has no accessible name."""
        tsx = '<a href="#"><img alt="" src="/deco.svg"/></a>'
        results = _run(ButtonAriaLabelRule(), tsx)
        assert len(results) == 1
        assert "<a> link" in results[0][1]

    def test_descendant_aria_label_on_link_passes(self):
        tsx = '<a href="#"><svg aria-label="Twitter" /></a>'
        assert _run(ButtonAriaLabelRule(), tsx) == []


class TestDialogDescriptionRule:
    def test_missing_description_flagged(self):
        tsx = "<DialogContent><p>Body</p></DialogContent>"
        results = _run(DialogDescriptionRule(), tsx)
        assert len(results) == 1
        assert "DialogDescription" in results[0][1]

    def test_child_dialog_description_passes(self):
        tsx = (
            "<DialogContent>"
            "<DialogDescription>Add a new client</DialogDescription>"
            "</DialogContent>"
        )
        assert _run(DialogDescriptionRule(), tsx) == []

    def test_aria_describedby_passes(self):
        tsx = "<DialogContent aria-describedby={descId}>Body</DialogContent>"
        assert _run(DialogDescriptionRule(), tsx) == []

    def test_no_dialog_content_stays_silent(self):
        tsx = "<div>No dialog here</div>"
        assert _run(DialogDescriptionRule(), tsx) == []

    def test_description_outside_dialog_content_still_satisfies(self):
        # Some layouts render DialogDescription elsewhere (portal / sibling).
        # The rule accepts any DialogDescription in the component tree.
        tsx = (
            "<>"
            "<DialogContent>Body</DialogContent>"
            "<DialogDescription>Shared</DialogDescription>"
            "</>"
        )
        assert _run(DialogDescriptionRule(), tsx) == []
