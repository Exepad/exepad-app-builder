"""Regression tests for the editor-input config slimmer (Change 5).

The editor LLM should NOT see GCS-versioned source/compiled paths, but it
MUST see which components already exist so it can plan restore-vs-replace
rather than inventing. The slimmer drops `repo.*` paths/hashes but keeps a
minimal `repo.frontend.components` dict of `{name: {summary, source_hash}}`.

See `xdk89qba` post-mortem: editor saw an empty `/` page with NO `repo`
block and added a sibling `/index` page instead of repairing the slug.
"""

from __future__ import annotations

import json

import pytest

from main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow import (
    _slim_config_for_editor,
)

pytestmark = [pytest.mark.unit]


_FULL_CONFIG = {
    "uuid": "test-app",
    "name": "Test App",
    "frontend": {
        "pages": [
            {"slug": "/", "title": "Home", "content": []},
        ],
    },
    "repo": {
        "frontend": {
            "components": {
                "MainHeader": {
                    "type": "code_component",
                    "source": "code/frontend/components/MainHeader_abc123_v1.tsx",
                    "compiled": "compiled/frontend/components/MainHeader_abc123_v1.js",
                    "summary": "Top navigation bar",
                    "source_hash": "sha256:abc123",
                },
                "HomeContent": {
                    "type": "code_component",
                    "source": "code/frontend/components/HomeContent_def456_v1.tsx",
                    "compiled": "compiled/frontend/components/HomeContent_def456_v1.js",
                    "summary": "Mario platformer canvas",
                    "source_hash": "sha256:def456",
                },
            },
            "styles": {
                "theme.css": {"hash": "sha256:zzz999"},
            },
        },
        "backend": {"handlers": {"getTopScores": {"compiled": "x.js"}}},
    },
}


def test_slim_keeps_component_names_drops_paths():
    """Editor input MUST list component names; MUST NOT include source/compiled paths."""
    out = json.loads(_slim_config_for_editor(json.dumps(_FULL_CONFIG)))
    components = out["repo"]["frontend"]["components"]

    # Names preserved.
    assert set(components.keys()) == {"MainHeader", "HomeContent"}

    # Each entry keeps summary + source_hash; drops everything else.
    main = components["MainHeader"]
    assert main == {
        "summary": "Top navigation bar",
        "source_hash": "sha256:abc123",
    }
    assert "source" not in main
    assert "compiled" not in main
    assert "type" not in main

    # Other repo subtrees (styles, backend, etc.) are gone.
    assert "styles" not in out["repo"]["frontend"]
    assert "backend" not in out["repo"]


def test_slim_preserves_non_repo_fields():
    """Pages, name, etc. survive untouched."""
    out = json.loads(_slim_config_for_editor(json.dumps(_FULL_CONFIG)))
    assert out["name"] == "Test App"
    assert out["frontend"]["pages"][0]["slug"] == "/"


def test_slim_handles_missing_repo():
    """Config without a `repo` block is returned with no `repo` key added."""
    minimal = {"name": "X", "frontend": {"pages": []}}
    out = json.loads(_slim_config_for_editor(json.dumps(minimal)))
    assert "repo" not in out
    assert out["name"] == "X"


def test_slim_handles_empty_components_dict():
    """Empty repo.frontend.components is dropped (no slim dict needed)."""
    cfg = {
        "name": "X",
        "repo": {"frontend": {"components": {}}, "backend": {}},
    }
    out = json.loads(_slim_config_for_editor(json.dumps(cfg)))
    # No slim_components → no `repo` key emitted.
    assert "repo" not in out


def test_slim_returns_input_on_invalid_json():
    """Garbage in → garbage out (no crash)."""
    raw = "{not valid json}"
    assert _slim_config_for_editor(raw) == raw


def test_slim_skips_components_with_no_summary_or_hash():
    """Components missing both fields still appear with an empty entry."""
    cfg = {
        "repo": {
            "frontend": {
                "components": {
                    "Bare": {"type": "code_component"},
                }
            }
        }
    }
    out = json.loads(_slim_config_for_editor(json.dumps(cfg)))
    assert out["repo"]["frontend"]["components"] == {"Bare": {}}


# ── Phase 4: supporting_modules surfacing ────────────────────────────


def test_slim_preserves_supporting_modules_for_babel_shell_entry():
    """Phase 4: Editor needs supporting_modules to pick a module to target."""
    cfg = {
        "repo": {
            "frontend": {
                "components": {
                    "SchoolDashboardShell": {
                        "type": "code_component",
                        "source": "code/frontend/components/SchoolDashboardShell_x_v1.tsx",
                        "summary": "Dashboard shell with sidebar + 11 pages",
                        "source_hash": "sha256:x",
                        "supporting_modules": [
                            "DataLib",
                            "Charts",
                            "Shell",
                            "TweaksPanel",
                        ],
                    },
                    "SimpleEntry": {
                        "type": "code_component",
                        "summary": "Single-file component, no modules",
                        "source_hash": "sha256:y",
                        # No supporting_modules → omitted from output.
                    },
                }
            }
        }
    }
    out = json.loads(_slim_config_for_editor(json.dumps(cfg)))
    components = out["repo"]["frontend"]["components"]

    assert components["SchoolDashboardShell"]["supporting_modules"] == [
        "DataLib",
        "Charts",
        "Shell",
        "TweaksPanel",
    ]
    # Single-file entry has no supporting_modules key (cleaner editor input).
    assert "supporting_modules" not in components["SimpleEntry"]


def test_slim_skips_supporting_modules_when_empty():
    """Empty list contributes no field to the slim entry."""
    cfg = {
        "repo": {
            "frontend": {
                "components": {
                    "X": {
                        "type": "code_component",
                        "summary": "...",
                        "source_hash": "sha256:z",
                        "supporting_modules": [],
                    },
                }
            }
        }
    }
    out = json.loads(_slim_config_for_editor(json.dumps(cfg)))
    assert "supporting_modules" not in out["repo"]["frontend"]["components"]["X"]


def test_slim_supporting_modules_filters_non_strings():
    """Defensive: drop any non-string entries from a malformed list."""
    cfg = {
        "repo": {
            "frontend": {
                "components": {
                    "X": {
                        "supporting_modules": ["A", 42, None, "B", {"x": 1}],
                    },
                }
            }
        }
    }
    out = json.loads(_slim_config_for_editor(json.dumps(cfg)))
    assert out["repo"]["frontend"]["components"]["X"]["supporting_modules"] == ["A", "B"]
