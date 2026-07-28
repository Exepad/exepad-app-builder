"""Unit tests for ``ButtonComponentNoOnClickRule`` — function components
whose name ends in ``Button`` must accept ``onClick`` (or capture
``...rest``) so caller-side click handlers reach the rendered button.

Regression target: coje33ih DashboardContent's ``ActionButton`` which
destructured only ``{ icon, label }``, leaving three Quick Action
buttons inert.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_button_no_onclick import (
    ButtonComponentNoOnClickRule,
)


def _ctx(tsx: str) -> AstContext:
    return AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=parse_tsx(tsx))


def _findings(tsx: str) -> list:
    return list(ButtonComponentNoOnClickRule().check(_ctx(tsx)))


def test_coje33ih_action_button_flagged():
    tsx = """
    function ActionButton({ icon, label }) {
      return <button className="x"><div>{icon}</div><span>{label}</span></button>;
    }
    """
    findings = _findings(tsx)
    assert len(findings) == 1
    assert "ActionButton" in findings[0].formatted_message()


def test_button_with_onclick_passes():
    tsx = """
    function ActionButton({ icon, label, onClick }) {
      return <button onClick={onClick}><div>{icon}</div><span>{label}</span></button>;
    }
    """
    assert _findings(tsx) == []


def test_button_with_rest_spread_passes():
    tsx = """
    function ActionButton({ icon, label, ...rest }) {
      return <button {...rest}><div>{icon}</div><span>{label}</span></button>;
    }
    """
    assert _findings(tsx) == []


def test_arrow_function_button_flagged():
    tsx = """
    const ActionButton = ({ icon, label }) => {
      return <button><div>{icon}</div><span>{label}</span></button>;
    };
    """
    findings = _findings(tsx)
    assert len(findings) == 1
    assert "ActionButton" in findings[0].formatted_message()


def test_opaque_props_passes():
    # If the function takes ``props`` opaquely we can't tell statically;
    # fail open.
    tsx = """
    function ActionButton(props) {
      return <button onClick={props.onClick}>{props.label}</button>;
    }
    """
    assert _findings(tsx) == []


def test_sdk_button_primitive_skipped():
    # The literal name ``Button`` is the SDK primitive — not a wrapper.
    tsx = """
    function Button({ children }) {
      return <button>{children}</button>;
    }
    """
    assert _findings(tsx) == []


def test_non_button_named_component_skipped():
    # Pure-render components aren't audited.
    tsx = """
    function UpdateItem({ title, date }) {
      return <div><p>{title}</p><p>{date}</p></div>;
    }
    """
    assert _findings(tsx) == []


def test_onclick_with_default_value_passes():
    tsx = """
    function ActionButton({ icon, label, onClick = () => {} }) {
      return <button onClick={onClick}>{label}</button>;
    }
    """
    assert _findings(tsx) == []


def test_multiple_button_components_each_flagged():
    tsx = """
    function PrimaryButton({ label }) { return <button>{label}</button>; }
    function SecondaryButton({ label }) { return <button>{label}</button>; }
    function GoodButton({ label, onClick }) { return <button onClick={onClick}>{label}</button>; }
    """
    findings = _findings(tsx)
    flagged = {f.formatted_message() for f in findings}
    assert len(findings) == 2
    assert any("PrimaryButton" in m for m in flagged)
    assert any("SecondaryButton" in m for m in flagged)
    assert not any("GoodButton" in m for m in flagged)
