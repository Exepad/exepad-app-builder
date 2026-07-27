"""Unit tests for ``HardcodedActivityDateRule`` — flags JSX attributes
carrying hardcoded relative-time or short-form date strings, the
signature of an agent-imagined activity feed.

Regression target: coje33ih Dashboard's "Recent Updates" feed (three
``<UpdateItem … date="2h ago"|"Yesterday"|"Sep 24" />`` lines with no
producing handler).
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_hardcoded_activity_dates import (
    HardcodedActivityDateRule,
)


def _ctx(tsx: str) -> AstContext:
    return AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=parse_tsx(tsx))


def _findings(tsx: str) -> list:
    return list(HardcodedActivityDateRule().check(_ctx(tsx)))


def test_coje33ih_recent_updates_feed_flagged():
    tsx = """
    function Dashboard() {
      return (
        <div>
          <UpdateItem title="AWS Alternative updated" date="2h ago" type="update" />
          <UpdateItem title="Labor rates adjusted" date="Yesterday" type="config" />
          <UpdateItem title="Baseline snapshot created" date="Sep 24" type="milestone" />
        </div>
      );
    }
    """
    findings = _findings(tsx)
    flagged = " | ".join(f.formatted_message() for f in findings)
    assert len(findings) == 3
    assert "2h ago" in flagged
    assert "Yesterday" in flagged
    assert "Sep 24" in flagged


def test_relative_time_phrases_flagged():
    tsx = """
    function C() {
      return (
        <div>
          <div date="Just now" />
          <div date="5 mins ago" />
          <div date="3 days ago" />
          <div date="2 weeks ago" />
        </div>
      );
    }
    """
    findings = _findings(tsx)
    assert len(findings) == 4


def test_iso_date_in_value_attr_flagged():
    tsx = """
    function C() {
      return <div value="2025-01-15" />;
    }
    """
    findings = _findings(tsx)
    assert len(findings) == 1


def test_non_date_text_passes():
    # Real legal / marketing / UI copy should not match.
    tsx = """
    function C() {
      return (
        <div>
          <div title="Welcome back" />
          <div label="Active" />
          <div description="Click here to continue" />
        </div>
      );
    }
    """
    assert _findings(tsx) == []


def test_dynamic_date_expression_not_flagged():
    # Bound values are fine — we only catch string literals.
    tsx = """
    function C({ items }) {
      return items.map(i => <div date={i.createdAt} />);
    }
    """
    assert _findings(tsx) == []


def test_attr_not_in_textlike_list_skipped():
    # ``className`` / ``id`` etc. shouldn't be audited.
    tsx = """
    function C() {
      return <div className="2h ago" id="Yesterday" data-name="Sep 24" />;
    }
    """
    assert _findings(tsx) == []


def test_dedup_per_line():
    # Two date attrs on the same line should not produce two findings —
    # one is enough signal for the reviewer.
    tsx = """function C() { return <div date="Yesterday" time="2h ago" />; }"""
    findings = _findings(tsx)
    assert len(findings) == 1


def test_month_with_year_flagged():
    tsx = 'function C() { return <div date="Sep 24, 2024" />; }'
    findings = _findings(tsx)
    assert len(findings) == 1
