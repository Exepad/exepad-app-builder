"""Deterministic runners for replay cases."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from main_agent.services.validation.final_compile_gate import run_final_compile_gate
from main_agent.services.validation.semantic_validator import run_semantic_checks
from main_agent.services.validation.style_coverage import extract_css_theme_color_values
from tests.e2e.utils.sse_parser import SSEEvent
from tests.e2e.utils.validation_runner import ValidationRunner

REPO_ROOT = Path(__file__).resolve().parents[2]


async def _collect_events(gen) -> list[Any]:
    events = []
    async for event in gen:
        events.append(event)
    return events


def _load_app_config(case_input: dict[str, Any]) -> dict[str, Any] | None:
    if "app_config" in case_input:
        return case_input["app_config"]
    fixture_path = case_input.get("app_config_fixture")
    if not fixture_path:
        return None
    resolved = REPO_ROOT / fixture_path
    return json.loads(resolved.read_text(encoding="utf-8"))


def _count_pages(app_config: dict[str, Any] | None) -> int:
    if not app_config:
        return 0
    if "pages" in app_config:
        return len(app_config.get("pages", []))
    frontend = app_config.get("frontend", {})
    return len(frontend.get("pages", []))


async def run_replay_case(case: dict[str, Any]) -> dict[str, Any]:
    """Execute a single replay case and return normalized results."""
    kind = case["kind"]
    case_input = case["input"]

    if kind == "semantic":
        theme_palette = case_input.get("theme_palette")
        if not theme_palette and case_input.get("base_css"):
            theme_palette = extract_css_theme_color_values(case_input["base_css"])
        result = run_semantic_checks(
            case_input["tsx"],
            case_input.get("models", []),
            case_input.get("logic", {}),
            case_input.get("page_slugs", []),
            expected_component_name=case_input.get("expected_component_name", ""),
            handlers=case_input.get("handlers"),
            theme_palette=theme_palette,
            contrast_warning_ratio=case_input.get("contrast_warning_ratio", 3.0),
        )
        return {"kind": kind, "result": result}

    if kind == "pipeline":
        try:
            result = run_final_compile_gate(
                theme_css=case_input.get("base_css", ""),
                tsx_sources=case_input["tsx_sources"],
            )
            return {
                "kind": kind,
                "events": [],
                "compile_result": {
                    "success": result.success,
                    "compiled_css": result.compiled_css,
                    "fatal_errors": result.fatal_errors,
                    "warnings": result.warnings,
                    "fixes_applied": result.fixes_applied,
                    "rewritten_theme_css": result.rewritten_theme_css,
                },
                "exception": None,
            }
        except Exception as exc:  # pragma: no cover - covered by replay cases
            return {
                "kind": kind,
                "events": [],
                "compile_result": None,
                "exception": exc,
            }

    if kind == "workflow":
        events = [SSEEvent.from_dict(event) for event in case_input["events"]]
        app_config = _load_app_config(case_input)
        runner = ValidationRunner(
            skip_config_validation=case_input.get("skip_config_validation", False)
        )
        report = runner.run_all_validations(events, app_config)
        schema_result = runner.run_schema_validation(app_config) if app_config else None
        return {
            "kind": kind,
            "events": events,
            "app_config": app_config,
            "page_count": _count_pages(app_config),
            "report": report,
            "schema_result": schema_result,
        }

    raise ValueError(f"Unknown replay kind: {kind}")
