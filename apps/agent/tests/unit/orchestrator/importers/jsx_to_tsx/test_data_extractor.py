"""Tests for the deterministic Babel-shell data extractor (Phase 3.1).

Covers:
  - Top-level array detection
  - Object literal parsing (strings, numbers, bools, null, nested
    objects, arrays, unary +/-)
  - Skip cases (heterogeneous arrays, JSX in values, function exprs,
    template strings, computed keys, spread elements)
  - Map-consumer matching across siblings
  - Column type inference (int, real, text, json, mixed)
  - Required vs optional column detection
  - Snake/plural conversion (STUDENTS → students, CLASSES_TODAY →
    classes_today)
  - Self-consumer counts (defining + mapping in the same module)
  - Skip when no .map() consumer found
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.jsx_to_tsx.data_extractor import (
    extract_babel_shell_data,
    _infer_columns,
    _parse_string,
    _parse_number,
    _pluralize,
    _snake_case,
    _to_snake_plural,
)

pytestmark = [pytest.mark.unit]


# ── Naming helpers ───────────────────────────────────────────────────


def test_snake_case_handles_all_caps_and_camel():
    assert _snake_case("STUDENTS") == "students"
    assert _snake_case("CLASSES_TODAY") == "classes_today"
    assert _snake_case("CamelCase") == "camel_case"
    assert _snake_case("alreadyMixed") == "already_mixed"
    assert _snake_case("simple") == "simple"


def test_pluralize_already_plural_unchanged():
    assert _pluralize("students") == "students"
    assert _pluralize("messages") == "messages"
    # `classes_today` has a plural-shaped head ("classes") so the
    # tail isn't pluralized into a nonsensical "todays".
    assert _pluralize("classes_today") == "classes_today"
    assert _pluralize("calendar_events") == "calendar_events"


def test_pluralize_singular_compound():
    """Compound noun where neither chunk is plural → pluralize tail."""
    assert _pluralize("billing_summary") == "billing_summaries"


def test_pluralize_singular_adds_s():
    assert _pluralize("student") == "students"
    assert _pluralize("admin_user") == "admin_users"


def test_pluralize_y_ies():
    assert _pluralize("baby") == "babies"
    assert _pluralize("boy") == "boys"  # vowel before y → just +s


def test_pluralize_es_endings():
    assert _pluralize("box") == "boxes"
    assert _pluralize("brush") == "brushes"
    assert _pluralize("watch") == "watches"


def test_to_snake_plural():
    assert _to_snake_plural("STUDENTS") == "students"
    assert _to_snake_plural("STUDENT") == "students"
    assert _to_snake_plural("ADMIN_USER") == "admin_users"


# ── Value parsing ────────────────────────────────────────────────────


def test_parse_string_basic_quotes():
    assert _parse_string('"hello"') == "hello"
    assert _parse_string("'world'") == "world"


def test_parse_string_escape_sequences():
    assert _parse_string('"line1\\nline2"') == "line1\nline2"
    assert _parse_string("'quote\\'s'") == "quote's"


def test_parse_string_literal_backslash_not_re_interpreted():
    """`"a\\\\nb"` in JS evaluates to `a\\nb` (literal backslash + n),
    NOT `a` + newline + `b`. The walker must process escapes
    left-to-right without re-parsing the result."""
    # 4 chars between quotes: a, \, \, n, b → should yield a, \, n, b
    assert _parse_string('"a\\\\nb"') == "a\\nb"
    # Pure literal backslash pair → one backslash
    assert _parse_string('"\\\\"') == "\\"


def test_parse_string_unknown_escape_drops_backslash():
    """JS lets `"\\x"` (unknown escape) collapse to `"x"`."""
    assert _parse_string('"\\x"') == "x"


def test_parse_number_int_vs_float():
    assert _parse_number("42") == 42
    assert _parse_number("3.14") == 3.14
    assert _parse_number("1_000") == 1000  # JS numeric separator
    assert _parse_number("1e3") == 1000.0


# ── Column inference ─────────────────────────────────────────────────


def test_infer_columns_basic_types():
    rows = [
        {"id": 1, "name": "Alice", "gpa": 3.5, "active": True},
        {"id": 2, "name": "Bob", "gpa": 3.7, "active": False},
    ]
    cols = _infer_columns(rows)
    by_name = {c.name: c for c in cols}
    assert by_name["id"].type == "integer"
    assert by_name["name"].type == "text"
    assert by_name["gpa"].type == "real"
    assert by_name["active"].type == "integer"  # SQLite has no bool
    assert all(c.required for c in cols)


def test_infer_columns_missing_field_is_optional():
    rows = [
        {"id": 1, "name": "Alice", "nickname": "Al"},
        {"id": 2, "name": "Bob"},  # no nickname
    ]
    cols = _infer_columns(rows)
    by_name = {c.name: c for c in cols}
    assert by_name["nickname"].required is False
    assert by_name["id"].required is True
    assert by_name["name"].required is True


def test_infer_columns_int_then_float_becomes_real():
    rows = [{"v": 1}, {"v": 2.5}]
    cols = _infer_columns(rows)
    assert cols[0].type == "real"


def test_infer_columns_nested_dict_becomes_json():
    rows = [
        {"meta": {"k": "v"}},
        {"meta": {"k": "w"}},
    ]
    cols = _infer_columns(rows)
    assert cols[0].type == "json"


def test_infer_columns_camel_keys_snake_cased():
    rows = [{"firstName": "A"}, {"firstName": "B"}]
    cols = _infer_columns(rows)
    assert cols[0].name == "first_name"


# ── End-to-end extraction ────────────────────────────────────────────


def test_extract_simple_data_array_with_consumer():
    data_module = """
const STUDENTS = [
  { id: 1000, name: "Amelia", grade: 5, gpa: 3.5 },
  { id: 1001, name: "Henry", grade: 7, gpa: 3.8 },
];
"""
    consumer_module = """
function StudentsTable() {
  return STUDENTS.map(s => <tr>{s.name}</tr>);
}
"""
    result = extract_babel_shell_data([
        ("Data", data_module),
        ("PageStudents", consumer_module),
    ])
    assert len(result.models) == 1
    model = result.models[0]
    assert model.name == "students"
    assert model.source_symbol == "STUDENTS"
    assert model.source_module == "Data"
    assert model.consumers == ["PageStudents"]
    assert len(model.seed_rows) == 2
    assert model.seed_rows[0]["name"] == "Amelia"
    by_name = {c.name: c for c in model.columns}
    assert by_name["id"].type == "integer"
    assert by_name["name"].type == "text"
    assert by_name["gpa"].type == "real"


def test_extract_multiple_models_across_siblings():
    """The Ashford-style scenario: data.jsx defines STUDENTS, MESSAGES,
    CALENDAR_EVENTS; multiple page modules consume each."""
    data_jsx = """
const STUDENTS = [
  { id: 1, name: "A" },
  { id: 2, name: "B" },
];
const MESSAGES = [
  { id: 1, subject: "hi", unread: true },
];
const CALENDAR_EVENTS = [
  { date: 1, title: "Recital", kind: "arts" },
  { date: 5, title: "Exam", kind: "academic" },
];
"""
    pages_jsx = """
function Overview() {
  return STUDENTS.map(s => <li/>);
}
function Inbox() {
  return MESSAGES.map(m => <div/>);
}
function Cal() {
  return CALENDAR_EVENTS.map(e => <span/>);
}
"""
    result = extract_babel_shell_data([
        ("Data", data_jsx),
        ("Pages", pages_jsx),
    ])
    names = sorted(m.name for m in result.models)
    assert names == ["calendar_events", "messages", "students"]


def test_skip_array_with_jsx_value():
    """Arrays containing JSX in element values aren't pure data."""
    src = """
const ICONS = [
  { name: "home", svg: <svg/> },
];
function Use() { return ICONS.map(i => <div/>); }
"""
    result = extract_babel_shell_data([("M", src)])
    assert result.models == []
    assert any(s for s in result.skipped if "ICONS" in s[1])


def test_skip_array_with_function_value():
    """Function/arrow values in element fields disqualify."""
    src = """
const ACTIONS = [
  { id: 1, fn: () => doThing() },
];
function Use() { return ACTIONS.map(a => <li/>); }
"""
    result = extract_babel_shell_data([("M", src)])
    assert result.models == []


def test_skip_array_with_template_string():
    src = """
const X = [
  { msg: `template ${variable}` },
];
function Use() { return X.map(x => <li/>); }
"""
    result = extract_babel_shell_data([("M", src)])
    assert result.models == []


def test_skip_array_with_spread_element():
    src = """
const X = [
  { ...defaults, id: 1 },
];
function Use() { return X.map(x => <li/>); }
"""
    result = extract_babel_shell_data([("M", src)])
    assert result.models == []


def test_skip_heterogeneous_array():
    """Array of mixed types (string + object) isn't a model."""
    src = """
const MIXED = ["a", { id: 1 }];
function Use() { return MIXED.map(x => <li/>); }
"""
    result = extract_babel_shell_data([("M", src)])
    assert result.models == []


def test_skip_array_with_no_consumer_at_all():
    """Array referenced ONLY in its own declaration → no consumer, skip.

    Phase 3.5 broadened consumer detection to ANY cross-statement
    reference (subscript access, component props, useState, etc.) — a
    single subscript like `TWEAK_DEFAULTS[0]` now qualifies. The
    skip-condition is now stricter: NO references outside the
    declaration. This test pins that behavior."""
    src = """
const ORPHAN = [
  { theme: "light" },
];
// no other reference to ORPHAN anywhere
"""
    result = extract_babel_shell_data([("M", src)])
    assert result.models == []
    assert any("no_map_consumer" in s[2] for s in result.skipped)


def test_subscript_access_now_counts_as_consumption():
    """`const X = TWEAK_DEFAULTS[0]` USED to skip (extractor required
    `.map()`); after the broaden it qualifies as consumption. The
    extractor's job is to surface "is this data?" — single-row lookup
    is still data access."""
    src = """
const TWEAK_DEFAULTS = [
  { theme: "light", accent: "forest" },
];
const FIRST = TWEAK_DEFAULTS[0];  // counts as a consumer reference
"""
    result = extract_babel_shell_data([("M", src)])
    assert len(result.models) == 1
    assert result.models[0].name == "tweak_defaults"


def test_self_consumer_counts():
    """A module that BOTH defines and maps a constant in its render
    block is a valid consumer of itself."""
    src = """
const TASKS = [
  { id: 1, label: "Sign forms" },
];
function Render() { return TASKS.map(t => <li>{t.label}</li>); }
"""
    result = extract_babel_shell_data([("Page", src)])
    assert len(result.models) == 1
    assert result.models[0].consumers == ["Page"]


def test_unary_minus_handled():
    """Negative number literals (`{ delta: -0.3 }`) parse correctly."""
    src = """
const KPIS = [
  { name: "Retention", delta: -0.3 },
  { name: "Enrollment", delta: 18 },
];
function Render() { return KPIS.map(k => <li/>); }
"""
    result = extract_babel_shell_data([("M", src)])
    assert len(result.models) == 1
    rows = result.models[0].seed_rows
    assert rows[0]["delta"] == -0.3
    assert rows[1]["delta"] == 18


def test_disambiguates_colliding_model_names():
    """When two siblings define arrays that produce the same model
    name, the second gets a `_2` suffix."""
    data_a = """
const STUDENTS = [{ id: 1 }];
function Ua() { return STUDENTS.map(s=><li/>); }
"""
    data_b = """
const STUDENTS = [{ id: 2 }];
function Ub() { return STUDENTS.map(s=><li/>); }
"""
    # Note: in real Phase 2 emission, sibling files won't collide on
    # symbol names because the per-module emitter dedupes earlier. This
    # test verifies the extractor itself handles the collision
    # gracefully.
    result = extract_babel_shell_data([
        ("DataA", data_a),
        ("DataB", data_b),
    ])
    names = sorted(m.name for m in result.models)
    assert names == ["students", "students_2"]


def test_wiring_candidates_produced_per_consumer():
    """Each (consumer, symbol) pair becomes one wiring candidate. Each
    candidate carries the source module too so Phase 3.3's building
    plan can name the right import to strip."""
    data_jsx = """
const STUDENTS = [{ id: 1, name: "A" }];
"""
    a = """function A() { return STUDENTS.map(s=><tr/>); }"""
    b = """function B() { return STUDENTS.map(s=><li/>); }"""
    result = extract_babel_shell_data([
        ("Data", data_jsx),
        ("PageA", a),
        ("PageB", b),
    ])
    consumers = {(w.module_name, w.model_name) for w in result.wiring_candidates}
    assert ("PageA", "students") in consumers
    assert ("PageB", "students") in consumers
    # Each wiring candidate records WHERE the symbol was declared.
    for w in result.wiring_candidates:
        assert w.source_module == "Data"
        assert w.symbol == "STUDENTS"


def test_export_const_array_detected():
    """`export const NAME = [...]` (already-exported in per-module
    output) should be detected just like `const NAME = [...]`."""
    src = """
export const ITEMS = [{ id: 1 }, { id: 2 }];
function Use() { return ITEMS.map(i=><li/>); }
"""
    result = extract_babel_shell_data([("M", src)])
    assert len(result.models) == 1
    assert result.models[0].name == "items"


def test_empty_modules_returns_empty_result():
    result = extract_babel_shell_data([])
    assert result.models == []
    assert result.wiring_candidates == []
