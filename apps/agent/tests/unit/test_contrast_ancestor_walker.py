"""Unit tests for the JSX ancestor walker (Track 2).

The walker is the core primitive every ancestor-aware contrast check
depends on.  These tests cover the tokenizer edge cases the legacy
per-className regex had no story for: self-closing tags, fragments,
template-literal classNames with ``${}`` expressions, conditional
``clsx``-style ternaries, and the sidebar skill pattern where the
background lives in ``style={{ backgroundColor: 'var(--color-X)' }}``
instead of a className.

Failure modes tracked here:

- Bare children should resolve to the nearest enclosing explicit bg.
- Self-closing tags must not leak onto sibling/descendant stacks.
- Fragments must be transparent (not mistaken for a wrapping element).
- Low-opacity dark tints (``bg-primary/10``) must NOT contribute an
  ancestor bg — they're decorative, the real bg is whatever's beneath.
- Template literal ``${}`` expressions must be stripped before bg
  extraction so conditional classes don't leak unresolved tokens.
- ``style={{ backgroundColor: 'var(--color-sidebar)' }}`` must count
  as a same-element bg token so sidebars don't become false positives.
- ``bg-muted`` and other unknown tokens must be silent (None).
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import (
    iter_jsx_elements_with_bg_context,
)

pytestmark = [pytest.mark.unit]


def _scopes(tsx: str) -> list[dict]:
    """Collect walker output as list of {class, own, ancestor, effective} dicts."""
    tree = parse_tsx(tsx)
    buf = source_bytes(tsx)
    return [
        {
            "class": s.class_str.strip(),
            "own": s.own_bg_token,
            "ancestor": s.ancestor_bg_token,
            "effective": s.effective_bg_token,
        }
        for s in iter_jsx_elements_with_bg_context(tree.root_node, buf)
    ]


class TestBasicAncestry:
    def test_bare_child_inherits_parent_bg(self):
        tsx = '<div className="bg-secondary"><p className="text-on-secondary">x</p></div>'
        scopes = _scopes(tsx)
        assert scopes[0]["own"] == "secondary"
        assert scopes[1]["own"] is None
        assert scopes[1]["ancestor"] == "secondary"
        assert scopes[1]["effective"] == "secondary"

    def test_deeply_nested_bare_child(self):
        tsx = """
        <section className="bg-primary">
          <div>
            <article>
              <span className="text-on-primary">x</span>
            </article>
          </div>
        </section>
        """
        scopes = _scopes(tsx)
        # The <span> is 3 levels deep inside bg-primary.
        span = next(s for s in scopes if "text-on-primary" in s["class"])
        assert span["ancestor"] == "primary"
        assert span["effective"] == "primary"

    def test_sibling_scopes_share_same_ancestor(self):
        tsx = """
        <div className="bg-secondary">
          <p className="text-on-secondary">first</p>
          <p className="text-on-secondary">second</p>
          <p className="text-on-secondary">third</p>
        </div>
        """
        scopes = _scopes(tsx)
        text_children = [s for s in scopes if "text-on-secondary" in s["class"]]
        assert len(text_children) == 3
        assert all(s["ancestor"] == "secondary" for s in text_children)

    def test_own_bg_overrides_ancestor(self):
        tsx = """
        <div className="bg-primary">
          <aside className="bg-surface text-on-surface">nested light card</aside>
        </div>
        """
        scopes = _scopes(tsx)
        aside = next(s for s in scopes if "text-on-surface" in s["class"])
        assert aside["own"] == "surface"
        assert aside["ancestor"] == "primary"
        assert aside["effective"] == "surface"

    def test_unknown_bg_token_produces_none(self):
        tsx = '<div className="bg-muted"><p className="text-on-primary">x</p></div>'
        scopes = _scopes(tsx)
        assert scopes[0]["own"] is None  # bg-muted is unknown
        assert scopes[1]["ancestor"] is None  # bare child, unknown parent


class TestSelfClosingTags:
    def test_self_closing_does_not_leak(self):
        tsx = """
        <div className="bg-primary">
          <img className="rounded" />
          <hr />
          <p className="text-on-primary">after siblings</p>
        </div>
        """
        scopes = _scopes(tsx)
        # <p> should still see bg-primary ancestor, not be poisoned.
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] == "primary"

    def test_self_closing_with_bg_does_not_poison_siblings(self):
        """A self-closing element with its own bg must not persist on stack."""
        tsx = """
        <div className="bg-surface">
          <Box className="bg-primary" />
          <p className="text-on-surface">sibling</p>
        </div>
        """
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-surface" in s["class"])
        assert p_scope["ancestor"] == "surface"


class TestFragments:
    def test_fragment_is_transparent(self):
        tsx = """
        <>
          <div className="bg-primary">
            <p className="text-on-primary">inside frag</p>
          </div>
        </>
        """
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] == "primary"

    def test_nested_fragments(self):
        tsx = """
        <div className="bg-secondary">
          <>
            <>
              <p className="text-on-secondary">deeply wrapped</p>
            </>
          </>
        </div>
        """
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-secondary" in s["class"])
        assert p_scope["ancestor"] == "secondary"


class TestTemplateLiterals:
    def test_template_literal_static_bg_resolved(self):
        tsx = """
        <div className={`bg-primary ${active ? "shadow-lg" : ""}`}>
          <span className="text-on-primary">x</span>
        </div>
        """
        scopes = _scopes(tsx)
        div = next(s for s in scopes if s["own"] is not None)
        assert div["own"] == "primary"
        span = next(s for s in scopes if "text-on-primary" in s["class"])
        assert span["ancestor"] == "primary"

    def test_template_literal_dynamic_bg_is_silent(self):
        """Bg token inside ${} is opaque — do not resolve a token."""
        tsx = """
        <div className={`p-4 ${dark ? "bg-primary" : "bg-surface"}`}>
          <span className="text-on-primary">x</span>
        </div>
        """
        scopes = _scopes(tsx)
        div = next(s for s in scopes if "p-4" in s["class"])
        # Dynamic part was stripped — no own bg resolved.
        assert div["own"] is None
        span = next(s for s in scopes if "text-on-primary" in s["class"])
        # No resolvable ancestor — walker stays silent.
        assert span["ancestor"] is None


class TestStyleVarPattern:
    def test_style_var_counts_as_own_bg(self):
        """Sidebar skill pattern: bg via CSS var in inline style={{}}."""
        tsx = """
        <aside
          className="fixed inset-y-0"
          style={{ backgroundColor: 'var(--color-sidebar, var(--color-primary))' }}
        >
          <nav className="text-on-primary">Links</nav>
        </aside>
        """
        scopes = _scopes(tsx)
        aside = next(s for s in scopes if "fixed" in s["class"])
        assert aside["own"] == "sidebar"
        nav = next(s for s in scopes if "text-on-primary" in s["class"])
        assert nav["ancestor"] == "sidebar"

    def test_className_bg_takes_precedence_over_style_var(self):
        tsx = (
            '<div className="bg-surface" '
            "style={{ backgroundColor: 'var(--color-primary)' }}>"
            '<p className="text-on-surface">x</p>'
            "</div>"
        )
        scopes = _scopes(tsx)
        div = next(s for s in scopes if "bg-surface" in s["class"])
        # className bg wins.
        assert div["own"] == "surface"


class TestLowOpacityTints:
    def test_low_opacity_dark_bg_not_resolved(self):
        """bg-primary/10 is decorative — must not establish an ancestor bg."""
        tsx = """
        <div className="bg-primary/10 p-4">
          <p className="text-on-primary">x</p>
        </div>
        """
        scopes = _scopes(tsx)
        div = next(s for s in scopes if "bg-primary/10" in s["class"])
        assert div["own"] is None
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] is None

    def test_high_opacity_is_resolved(self):
        """bg-primary/60 is still readable as dark primary."""
        tsx = '<div className="bg-primary/60"><p className="text-on-primary">x</p></div>'
        scopes = _scopes(tsx)
        div = next(s for s in scopes if s["own"] is not None)
        assert div["own"] == "primary"

    def test_low_opacity_inverse_surface_not_resolved(self):
        tsx = """
        <div className="bg-inverse-surface/40">
          <p className="text-on-surface">overlay</p>
        </div>
        """
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-surface" in s["class"])
        assert p_scope["ancestor"] is None


class TestTailwindLaterWins:
    def test_last_bg_class_in_className_wins(self):
        """Tailwind resolves conflicts in declaration order — later wins."""
        tsx = '<div className="bg-surface bg-primary"><p className="text-on-primary">x</p></div>'
        scopes = _scopes(tsx)
        div = next(s for s in scopes if s["own"] is not None)
        assert div["own"] == "primary"


class TestCloseTagMatching:
    def test_close_tag_pops_matching_entry(self):
        # Wrapped in a fragment so the tree-sitter parse is well-formed;
        # the legacy regex walker tolerated top-level siblings, the AST
        # walker requires syntactically valid JSX.
        tsx = """
        <>
          <div className="bg-primary">
            <span className="text-on-primary">x</span>
          </div>
          <p className="text-on-surface">sibling outside</p>
        </>
        """
        scopes = _scopes(tsx)
        outside = next(
            s
            for s in scopes
            if "sibling outside" not in s["class"] and "text-on-surface" in s["class"]
        )
        assert outside["ancestor"] is None  # Outside the div, no ancestor.

    def test_unclosed_tag_does_not_crash(self):
        tsx = '<div className="bg-primary"><span className="text-on-primary">x</span>'
        scopes = _scopes(tsx)
        # Should still yield scopes without throwing. Tree-sitter recovers
        # the inner span even though the outer div has no closing tag.
        assert len(scopes) >= 1


class TestRealWorldPattern:
    def test_gym_members_table_header(self):
        """Regression: the exact pattern from MembersContent that produced
        17 false positives under the legacy per-className detector.
        """
        tsx = """
        <thead className="bg-secondary">
          <tr>
            <th className="text-on-secondary font-bold">Name</th>
            <th className="text-on-secondary font-bold">Email</th>
            <th className="text-on-secondary">Tier</th>
            <th className="text-on-secondary">Join Date</th>
            <th className="text-on-secondary">Status</th>
          </tr>
        </thead>
        """
        scopes = _scopes(tsx)
        text_children = [s for s in scopes if "text-on-secondary" in s["class"]]
        assert len(text_children) == 5
        # All correctly see the bg-secondary ancestor.
        assert all(s["ancestor"] == "secondary" for s in text_children)
        assert all(s["own"] is None for s in text_children)

    def test_nested_light_card_in_dark_band(self):
        tsx = """
        <section className="bg-primary px-6 py-20 text-on-primary">
          <div className="space-y-5">
            <h2 className="text-4xl">Title</h2>
          </div>
          <article className="rounded bg-surface p-6 text-on-surface">
            <p className="text-on-surface-variant">Muted body</p>
          </article>
        </section>
        """
        scopes = _scopes(tsx)
        h2 = next(s for s in scopes if "text-4xl" in s["class"])
        p = next(s for s in scopes if "text-on-surface-variant" in s["class"])
        assert h2["ancestor"] == "primary"
        # The <p> is inside bg-surface, which overrides the bg-primary section.
        assert p["ancestor"] == "surface"


class TestEdgeCasesAndSyntaxParsing:
    """Pathological or unusual JSX the tokenizer must still handle."""

    def test_pascal_case_component_name(self):
        """Components like <Card bg-primary> should be tracked."""
        tsx = '<Card className="bg-primary"><p className="text-on-primary">x</p></Card>'
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] == "primary"

    def test_dotted_component_name(self):
        """Namespaced components like <Icons.User /> — dots in tag names."""
        tsx = """
        <div className="bg-secondary">
          <Icons.User className="w-5 h-5" />
          <Motion.div className="text-on-secondary">animated</Motion.div>
        </div>
        """
        scopes = _scopes(tsx)
        motion_scope = next(s for s in scopes if "text-on-secondary" in s["class"])
        assert motion_scope["ancestor"] == "secondary"

    def test_boundary_opacity_exactly_60(self):
        """bg-primary/60 is the first value that counts as "dark enough"."""
        tsx = '<div className="bg-primary/60"><p className="text-on-primary">x</p></div>'
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] == "primary"

    def test_boundary_opacity_exactly_59(self):
        """bg-primary/59 is still "too transparent" to count."""
        tsx = '<div className="bg-primary/59"><p className="text-on-primary">x</p></div>'
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] is None

    def test_primary_container_is_a_separate_token(self):
        """bg-primary-container must NOT be matched as bg-primary.

        Regression: harvested from BookingContent_1ba8585e43ed5bb7 — the
        LLM uses bg-secondary-container + text-on-secondary-container as
        a legitimate light-surface chip.  The walker must surface
        ``secondary-container`` (a LIGHT token), not ``secondary``, so
        downstream checks don't mistake it for a dark ancestor.
        """
        tsx = '<div className="bg-primary-container"><span className="text-on-primary-container">chip</span></div>'
        scopes = _scopes(tsx)
        div = next(s for s in scopes if "bg-primary-container" in s["class"])
        assert div["own"] == "primary-container"
        span = next(s for s in scopes if "text-on-primary-container" in s["class"])
        assert span["ancestor"] == "primary-container"

    def test_secondary_container_is_light(self):
        tsx = '<div className="bg-secondary-container text-on-secondary-container">x</div>'
        scopes = _scopes(tsx)
        assert scopes[0]["own"] == "secondary-container"

    def test_string_attribute_with_gt(self):
        """Attribute value `title="a > b"` must not terminate the tag."""
        tsx = (
            '<div title="a > b" className="bg-primary">'
            '<p className="text-on-primary">x</p>'
            "</div>"
        )
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] == "primary"

    def test_arrow_function_in_attribute(self):
        """`onClick={() => <span />}` must not terminate the outer tag."""
        tsx = """
        <button className="bg-primary" onClick={() => <span />}>
          <p className="text-on-primary">x</p>
        </button>
        """
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] == "primary"

    def test_jsx_expression_child(self):
        """Conditional child `{cond && <Card />}` must not corrupt the stack."""
        tsx = """
        <section className="bg-primary">
          {isActive && <Badge className="text-on-primary" />}
          <p className="text-on-primary">after the expression</p>
        </section>
        """
        scopes = _scopes(tsx)
        badge = next(s for s in scopes if "text-on-primary" in s["class"] and s["own"] is None)
        assert badge["ancestor"] == "primary"

    def test_multiple_bg_classes_last_wins(self):
        """Tailwind conflict resolution: later class wins."""
        tsx = '<div className="bg-surface bg-primary text-on-primary">x</div>'
        scopes = _scopes(tsx)
        assert scopes[0]["own"] == "primary"

    def test_multiple_bg_classes_dark_then_light_last_wins(self):
        tsx = '<div className="bg-primary bg-surface"><p className="text-on-surface">x</p></div>'
        scopes = _scopes(tsx)
        div = next(s for s in scopes if "bg-primary bg-surface" in s["class"])
        assert div["own"] == "surface"
        p_scope = next(s for s in scopes if "text-on-surface" in s["class"])
        assert p_scope["ancestor"] == "surface"

    def test_style_with_raw_hex_not_recognized(self):
        """style={{ backgroundColor: '#abc' }} — not a CSS var, stay silent."""
        tsx = (
            "<div style={{ backgroundColor: '#1c1b1f' }}>"
            '<p className="text-on-primary">x</p>'
            "</div>"
        )
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-primary" in s["class"])
        assert p_scope["ancestor"] is None

    def test_self_closing_component_with_bg_and_className(self):
        """A self-closing Card with bg must not push onto stack."""
        tsx = """
        <div>
          <Card className="bg-primary" label="unread" />
          <p className="text-on-surface">sibling below</p>
        </div>
        """
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-surface" in s["class"])
        assert p_scope["ancestor"] is None  # sibling, not a descendant

    def test_mix_of_quoted_and_template_classnames_same_tree(self):
        tsx = """
        <section className="bg-primary">
          <h2 className="text-on-primary">quoted</h2>
          <p className={`text-on-primary text-lg`}>template literal</p>
        </section>
        """
        scopes = _scopes(tsx)
        children = [s for s in scopes if "text-on-primary" in s["class"]]
        assert len(children) == 2
        assert all(s["ancestor"] == "primary" for s in children)

    def test_deeply_nested_fragments_and_self_closing(self):
        tsx = """
        <div className="bg-secondary">
          <>
            <img src="x.png" />
            <>
              <p className="text-on-secondary">deep in fragments + self-close</p>
            </>
          </>
        </div>
        """
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-secondary" in s["class"])
        assert p_scope["ancestor"] == "secondary"

    def test_onprimary_container_not_matched_as_onprimary(self):
        """text-on-primary-container is a valid M3 token — not a violation.

        Regression from corpus scan (RequestListContent_fbce13c325419db6):
        the legacy regex matched ``text-on-primary`` inside
        ``text-on-primary-container`` because of a word-boundary bug.
        The walker surfaces no violation here.
        """
        tsx = '<div className="bg-surface"><p className="text-on-primary-container">chip</p></div>'
        scopes = _scopes(tsx)
        p_scope = next(s for s in scopes if "text-on-primary-container" in s["class"])
        # No own bg on the <p>, ancestor is bg-surface (light).
        assert p_scope["ancestor"] == "surface"
        # The walker itself doesn't care about the text token — that's the
        # check's job — but confirm the className was captured verbatim.
        assert "text-on-primary-container" in p_scope["class"]
