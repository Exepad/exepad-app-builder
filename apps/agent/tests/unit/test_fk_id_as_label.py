"""Tests for ``component.jsx.fk_id_as_label`` — warns when FK ids are
rendered directly inside label-y JSX cells (``<TableCell>``,
``<th>``, headings, etc.) without a sibling display field.
"""

from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_fk_id_label import (
    FkIdAsLabelRule,
)


def _run(tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return [f.message for f in FkIdAsLabelRule().check(ctx)]


class TestFires:
    def test_table_cell_with_pound_prefix(self):
        # The StayNexus dashboard pattern: `<TableCell>#{res.guest_id}</TableCell>`.
        tsx = """function C() {
  return (<TableCell>#{res.guest_id}</TableCell>);
}
"""
        msgs = _run(tsx)
        assert len(msgs) == 1
        assert "guest_id" in msgs[0]

    def test_table_cell_bare_fk_expression(self):
        tsx = """function C() {
  return (<TableCell>{row.user_id}</TableCell>);
}
"""
        msgs = _run(tsx)
        assert len(msgs) == 1
        assert "user_id" in msgs[0]

    def test_heading_with_room_id(self):
        # `<h4>Room #{task.room_id}</h4>` — second StayNexus dashboard case.
        tsx = """function C() {
  return (<h4>Room #{task.room_id}</h4>);
}
"""
        msgs = _run(tsx)
        assert len(msgs) == 1
        assert "room_id" in msgs[0]

    def test_table_head_fires(self):
        tsx = """function C() {
  return (<TableHead>{order.customer_id}</TableHead>);
}
"""
        assert len(_run(tsx)) == 1

    def test_lowercase_td_fires(self):
        tsx = """function C() {
  return (<td>{r.guest_id}</td>);
}
"""
        assert len(_run(tsx)) == 1


class TestDoesNotFire:
    def test_no_fk_id_no_warn(self):
        tsx = """function C() {
  return (<TableCell>{row.full_name}</TableCell>);
}
"""
        assert _run(tsx) == []

    def test_sibling_name_dampens(self):
        # Display name + id-as-fallback. Should not warn.
        tsx = """function C() {
  return (<TableCell>{row.guest_name ?? row.guest_id}</TableCell>);
}
"""
        assert _run(tsx) == []

    def test_sibling_label_dampens(self):
        tsx = """function C() {
  return (<TableCell>{row.product_label}: {row.product_id}</TableCell>);
}
"""
        assert _run(tsx) == []

    def test_sibling_title_dampens(self):
        tsx = """function C() {
  return (<TableCell>{row.title} ({row.user_id})</TableCell>);
}
"""
        assert _run(tsx) == []

    def test_non_label_tag_skipped(self):
        # `<div>` isn't in the label-tag set — skip.
        tsx = """function C() {
  return (<div>#{row.guest_id}</div>);
}
"""
        assert _run(tsx) == []

    def test_button_label_with_id_skipped(self):
        # `<button>` isn't a label tag.
        tsx = """function C() {
  return (<button>Edit {row.guest_id}</button>);
}
"""
        assert _run(tsx) == []

    def test_id_property_alone_does_not_fire(self):
        # The primary key on the row itself isn't an FK — only `_id`-suffixed
        # properties trip the rule, but `row.id` doesn't end in `_id`
        # underscore — wait, actually it does end in 'id'. We require
        # the underscore-prefix to discriminate. Test: `row.id` should NOT fire.
        tsx = """function C() {
  return (<TableCell>{row.id}</TableCell>);
}
"""
        # `id` doesn't end in `_id`, so no finding.
        assert _run(tsx) == []
