"""Tests for ``DeadActionButtonRule``.

Flags ``<button>`` / ``<Button>`` JSX with action-verb text content
where no onClick / href / type='submit' / spread / asChild binding
is present.

Regression: app ``r3hfcgx5`` (2026-05-14) OrdersContent toolbar
"Export CSV" button.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_dead_action_button import (
    DeadActionButtonRule,
)


def _run(tsx: str) -> list:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return list(run_rules(ctx, [DeadActionButtonRule()]))


class TestDeadActionButtonRule:
    def test_r3hfcgx5_export_csv_dead_button(self):
        tsx = """
function OrdersToolbar() {
  return (
    <header>
      <Button variant="outline" className="border-outline-variant/30 h-9">
        <Icons.Download className="w-4 h-4 mr-2" />
        Export CSV
      </Button>
    </header>
  );
}
"""
        findings = _run(tsx)
        assert len(findings) == 1
        assert "Export" in findings[0].message
        assert findings[0].severity == "warning"

    def test_save_button_with_onclick_silent(self):
        tsx = """
function X() {
  return <Button onClick={() => doSave()}>Save Changes</Button>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_submit_type_silent(self):
        tsx = """
function X() {
  return <button type="submit">Submit Order</button>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_href_silent(self):
        tsx = """
function X() {
  return <Button href="/download.csv">Download Report</Button>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_spread_props_silent(self):
        """``...rest`` forwards handlers from caller."""
        tsx = """
function X(props) {
  return <Button {...props}>Send Message</Button>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_dialog_close_slot_silent(self):
        """``<DialogClose>`` auto-binds the close handler."""
        tsx = """
function X() {
  return (
    <DialogClose>
      <Button variant="ghost">Cancel</Button>
    </DialogClose>
  );
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_non_action_text_silent(self):
        """Non-action text doesn't trip the rule."""
        tsx = """
function X() {
  return <Button>Welcome</Button>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_aschild_silent(self):
        """Radix ``asChild`` delegates handlers to the inner element."""
        tsx = """
function X() {
  return <Button asChild><Link to="/x">Sign In</Link></Button>;
}
"""
        findings = _run(tsx)
        assert findings == []
