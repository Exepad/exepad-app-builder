"""Export test-mode workflow outputs under runtime/public/example/<run_id>."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _get_example_base_dir() -> Path:
    """Lazily compute the example base directory.

    Only works in local dev where the file is at:
      <repo_root>/apps/agent/main_agent/testing/run_exporter.py
        parents[0] = .../testing/
        parents[1] = .../main_agent/
        parents[2] = .../agent/
        parents[3] = .../apps/
        parents[4] = <repo_root>

    In production (Docker), the path hierarchy is shallower so parents[4]
    would raise IndexError.  This function is only called when IS_TEST is
    true, which is never the case in production.
    """
    repo_root = Path(__file__).resolve().parents[4]
    return repo_root / "apps" / "runtime" / "public" / "example"


def _next_run_id() -> str:
    """Return the next auto-incremented run id (run_1, run_2, ...).

    Scans existing ``run_N`` directories under the example base dir and
    returns ``run_{max_N + 1}``.
    """
    base_dir = _get_example_base_dir()
    base_dir.mkdir(parents=True, exist_ok=True)
    max_n = 0
    pattern = re.compile(r"^run_(\d+)$")
    for child in base_dir.iterdir():
        if child.is_dir():
            m = pattern.match(child.name)
            if m:
                max_n = max(max_n, int(m.group(1)))
    return f"run_{max_n + 1}"


def _get_test_output_dir() -> tuple[str, Path]:
    """Create and return (run_id, output_dir) with an auto-incremented run id."""
    run_id = _next_run_id()
    output_dir = _get_example_base_dir() / run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    return run_id, output_dir


def _write_json_file(path: Path, data: Any) -> None:
    """Write JSON data with UTF-8 encoding."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _build_progress_log(captured_events: list[dict]) -> str:
    """Create a human-readable progress log from SSE events."""
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("WORKFLOW PROGRESS LOG")
    lines.append("=" * 60)
    lines.append("")

    for event in captured_events:
        event_type = event.get("type", "unknown")
        action = event.get("action", "")
        timestamp = event.get("timestamp")
        timestamp_str = ""
        if isinstance(timestamp, (int, float)):
            try:
                timestamp_str = datetime.fromtimestamp(timestamp).strftime("%H:%M:%S.%f")[:-3]
            except (ValueError, OSError):
                timestamp_str = str(timestamp)

        if event_type == "progress":
            progress = event.get("progress", "")
            internal_message = event.get("internal_message", "")
            eta = event.get("estimated_time_to_complete")
            line = f"[{timestamp_str}] PROGRESS {progress}% | {action}: {internal_message}"
            if isinstance(eta, (int, float)) and eta != -1:
                line += f" (ETA: {int(eta)}s)"
            lines.append(line)
        elif event_type == "chat_message":
            text = str(event.get("text", ""))
            lines.append(f"[{timestamp_str}] CHAT: {text[:200]}{'...' if len(text) > 200 else ''}")
        elif event_type == "app_config_updated":
            reload_app = event.get("reload_app", False)
            lines.append(f"[{timestamp_str}] CONFIG UPDATED (reload: {reload_app})")
        elif event_type == "backend_response":
            status = event.get("callback_data", {}).get("status", "unknown")
            lines.append(f"[{timestamp_str}] BACKEND RESPONSE: {status}")
        else:
            lines.append(f"[{timestamp_str}] {event_type.upper()}: {action}")

    lines.append("")
    lines.append("=" * 60)
    lines.append(f"Total events: {len(captured_events)}")
    lines.append("=" * 60)
    return "\n".join(lines)


def _parse_app_config_from_session(session: Any) -> dict | None:
    """Extract app_config from session state as a dict when possible."""
    app_config = session.state.get("app_config")
    if isinstance(app_config, dict):
        return app_config
    if isinstance(app_config, str):
        try:
            return json.loads(app_config)
        except json.JSONDecodeError:
            return None
    return None


async def _save_artifacts(
    runner: Any, session: Any, debug_dir: Path
) -> tuple[list[str], list[dict]]:
    """Save all artifacts from the current session and return index metadata."""
    artifact_keys: list[str] = []
    artifacts_saved: list[dict] = []
    artifacts_dir = debug_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    try:
        artifact_keys = await runner.artifact_service.list_artifact_keys(
            session_id=session.id,
            user_id=session.user_id,
            app_name=session.app_name,
        )
    except Exception as e:
        logger.warning(f"Test export: failed to list artifacts for session {session.id}: {e}")
        return artifact_keys, artifacts_saved

    for artifact_key in artifact_keys:
        try:
            artifact = await runner.artifact_service.load_artifact(
                session_id=session.id,
                user_id=session.user_id,
                app_name=session.app_name,
                filename=artifact_key,
            )
            if not artifact:
                continue

            artifact_data = None
            mime_type = None
            if hasattr(artifact, "inline_data") and artifact.inline_data is not None:
                artifact_data = artifact.inline_data.data
                mime_type = getattr(artifact.inline_data, "mime_type", None)

            if artifact_data is None:
                continue

            safe_name = artifact_key.replace(":", "__")
            artifact_path = artifacts_dir / safe_name
            with open(artifact_path, "wb") as f:
                f.write(artifact_data)
            artifacts_saved.append(
                {
                    "artifact_key": artifact_key,
                    "saved_as": f"debug/artifacts/{safe_name}",
                    "size_bytes": len(artifact_data),
                    "mime_type": mime_type,
                }
            )
        except Exception as e:
            logger.warning(f"Test export: failed to save artifact {artifact_key}: {e}")

    return artifact_keys, artifacts_saved


def _build_repo_folder_structure(app_config: dict, output_dir: Path) -> None:
    """Create the repo folder structure from repo.backend.handlers, copying handler artifacts.

    For each handler in repo.backend.handlers, if a matching handler_code artifact
    exists in debug/artifacts/, copy it to the declared source path so the app
    is immediately runnable.
    """
    repo_methods = app_config.get("repo", {}).get("backend", {}).get("handlers", {})
    if not repo_methods:
        return

    artifacts_dir = output_dir / "debug" / "artifacts"
    copied_count = 0

    for method_name, method_config in repo_methods.items():
        source_path = method_config.get("source", "")
        if not source_path:
            continue

        # Find the matching handler artifact. Convention:
        #   artifact key: handler_code:<methodName>.tsx
        #   saved as:     debug/artifacts/handler_code__<methodName>.tsx
        artifact_file = artifacts_dir / f"handler_code__{method_name}.tsx"
        if not artifact_file.exists():
            logger.debug(
                f"Repo structure: no artifact found for method '{method_name}' "
                f"(expected {artifact_file})"
            )
            continue

        # Create the target path under the output directory
        target_path = output_dir / source_path
        target_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            import shutil

            shutil.copy2(artifact_file, target_path)
            copied_count += 1
        except Exception as e:
            logger.warning(f"Repo structure: failed to copy {artifact_file} -> {target_path}: {e}")

    if copied_count > 0:
        logger.info(
            f"Repo structure: copied {copied_count}/{len(repo_methods)} handler(s) "
            f"to declared source paths"
        )


def _build_seed_folder_structure(app_config: dict, output_dir: Path) -> None:
    """Copy seed CSV artifacts to their declared repo/seed/ paths.

    For each entry in repo.seed, find the matching seed artifact in
    debug/artifacts/ and copy it to the path declared in the config
    (e.g. repo/seed/customers_003d88f5e5fc.csv).
    """
    repo_seed = app_config.get("repo", {}).get("seed", {})
    if not repo_seed:
        return

    artifacts_dir = output_dir / "debug" / "artifacts"
    copied_count = 0

    for entry_name, entry_config in repo_seed.items():
        source_path = entry_config.get("source", "")
        if not source_path:
            continue

        # Convention: artifact key seed:<name>.csv → debug/artifacts/seed__<name>.csv
        artifact_file = artifacts_dir / f"seed__{entry_name}.csv"
        if not artifact_file.exists():
            logger.debug(
                f"Seed structure: no artifact found for '{entry_name}' "
                f"(expected {artifact_file})"
            )
            continue

        target_path = output_dir / source_path
        target_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            import shutil

            shutil.copy2(artifact_file, target_path)
            copied_count += 1
        except Exception as e:
            logger.warning(f"Seed structure: failed to copy {artifact_file} -> {target_path}: {e}")

    if copied_count > 0:
        logger.info(
            f"Seed structure: copied {copied_count}/{len(repo_seed)} seed file(s) "
            f"to declared source paths"
        )


async def export_test_run_data(
    *,
    runner: Any,
    session: Any,
    request_data: dict,
    payload_data: dict,
    request_id: str,
    captured_events: list[dict],
    workflow_failed: bool,
) -> None:
    """Persist test workflow outputs for inspection under runtime/public/example."""
    run_id, output_dir = _get_test_output_dir()
    debug_dir = output_dir / "debug"

    _write_json_file(debug_dir / "request.json", request_data)
    _write_json_file(debug_dir / "events.json", captured_events)
    with open(debug_dir / "progress_log.txt", "w", encoding="utf-8") as f:
        f.write(_build_progress_log(captured_events))

    backend_event = next(
        (event for event in reversed(captured_events) if event.get("type") == "backend_response"),
        None,
    )
    callback_data = backend_event.get("callback_data", {}) if backend_event else {}
    if callback_data:
        _write_json_file(debug_dir / "backend_response.json", callback_data)

    app_config_dict = _parse_app_config_from_session(session)
    if app_config_dict:
        _write_json_file(output_dir / "app_config.json", app_config_dict)
        try:
            from validation import validate_app_config

            validation_result = validate_app_config(
                json.dumps(app_config_dict, separators=(",", ":"), ensure_ascii=False),
                "WebAppProps",
            )
            _write_json_file(
                debug_dir / "schema_validation.json",
                {
                    "valid": validation_result.get("valid", False),
                    "error_count": len(validation_result.get("errors", [])),
                    "errors": validation_result.get("errors", []),
                    "target_type": "WebAppProps",
                },
            )
        except Exception as schema_error:
            _write_json_file(
                debug_dir / "schema_validation.json",
                {
                    "valid": False,
                    "error_count": 1,
                    "errors": [f"Schema validation failed to run: {schema_error}"],
                    "target_type": "WebAppProps",
                },
            )

    agent_errors = callback_data.get("agent_errors") or session.state.get("agent_errors", [])
    _write_json_file(debug_dir / "agent_errors.json", agent_errors)
    _write_json_file(debug_dir / "metrics_summary.json", callback_data.get("metrics", {}))
    _write_json_file(debug_dir / "generation_steps.json", session.state.get("generation_steps", []))

    component_validation_log = session.state.get("tsx_component_validation_log", [])
    _write_json_file(debug_dir / "component_validations.json", component_validation_log)

    state_snapshot = {
        "operation_mode": session.state.get("operation_mode"),
        "workflow_type": session.state.get("workflow_type"),
        "app_uuid": session.state.get("app_uuid"),
        "app_name": session.state.get("app_name"),
        "project_name": session.state.get("project_name"),
        "save_app_config": session.state.get("save_app_config"),
        "reload_app": session.state.get("reload_app"),
        "backend_saved": session.state.get("_backend_save_result"),
        "workflow_failed": workflow_failed,
    }
    _write_json_file(debug_dir / "session_state_snapshot.json", state_snapshot)

    artifact_keys, artifacts_saved = await _save_artifacts(runner, session, debug_dir)
    _write_json_file(debug_dir / "artifacts_index.json", artifacts_saved)

    # Build repo folder structure: copy handler artifacts to their declared source paths
    # so the app is immediately runnable without manual file reorganization.
    if app_config_dict:
        _build_repo_folder_structure(app_config_dict, output_dir)
        _build_seed_folder_structure(app_config_dict, output_dir)
    # Build a filtered list of only the failed component validation attempts
    component_validation_failures = [
        entry
        for entry in component_validation_log
        if isinstance(entry, dict) and not entry.get("is_valid", True)
    ]
    _write_json_file(
        debug_dir / "validation_errors.json",
        {
            "agent_errors": agent_errors,
            "generation_step_validation_errors": [
                step.get("validation_errors", [])
                for step in session.state.get("generation_steps", [])
                if isinstance(step, dict) and step.get("validation_errors")
            ],
            "component_validation_failures": component_validation_failures,
            "component_validation_failure_count": len(component_validation_failures),
            "schema_validation_file": "debug/schema_validation.json",
            "component_validations_file": "debug/component_validations.json",
        },
    )
    _write_json_file(
        debug_dir / "manifest.json",
        {
            "run_id": run_id,
            "request_id": request_id,
            "workflow_failed": workflow_failed,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "session_id": session.id,
            "user_id": session.user_id,
            "app_name": session.app_name,
            "event_count": len(captured_events),
            "artifact_key_count": len(artifact_keys),
            "artifacts_saved_count": len(artifacts_saved),
        },
    )

    logger.info(f"Test export completed: {output_dir}")
