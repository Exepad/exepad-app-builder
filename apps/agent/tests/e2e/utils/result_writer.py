"""Test result writer for E2E tests.

This module provides utilities for persisting test results to disk,
including request payloads, SSE events, app configs, and validation reports.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .sse_parser import SSEEvent


class ResultWriter:
    """Writes test results to timestamped directories.

    Directory structure:
        tests/e2e/output/
        └── 2026-01-16_14-30-45/              # Run timestamp
            ├── test_create_simple_website/
            │   ├── request.json              # Input payload
            │   ├── events.json               # All SSE events
            │   ├── app_config.json           # Final app config
            │   ├── progress_log.txt          # Human-readable progress
            │   └── validation_report.json    # Validation results
            └── summary.json                  # Overall run summary
    """

    def __init__(self, base_output_dir: Optional[Path] = None):
        """Initialize the result writer.

        Args:
            base_output_dir: Base directory for output. Defaults to tests/e2e/output/
        """
        if base_output_dir is None:
            # Default to tests/e2e/output relative to this file
            self.base_output_dir = Path(__file__).parent.parent / "output"
        else:
            self.base_output_dir = Path(base_output_dir)

    def create_run_directory(self) -> Path:
        """Create a timestamped directory for this test run.

        Returns:
            Path to the created run directory
        """
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        run_dir = self.base_output_dir / timestamp
        run_dir.mkdir(parents=True, exist_ok=True)
        return run_dir

    def create_test_directory(self, run_dir: Path, test_name: str) -> Path:
        """Create a directory for a specific test case.

        Args:
            run_dir: The run directory (from create_run_directory)
            test_name: Name of the test (e.g., "test_create_simple_portfolio_website")

        Returns:
            Path to the created test directory
        """
        # Clean the test name for filesystem
        clean_name = test_name.replace("::", "_").replace(" ", "_")
        test_dir = run_dir / clean_name
        test_dir.mkdir(parents=True, exist_ok=True)
        return test_dir

    def save_request(self, test_dir: Path, payload: Dict[str, Any]) -> Path:
        """Save the request payload.

        Args:
            test_dir: Test output directory
            payload: The request payload sent to /r endpoint

        Returns:
            Path to the saved file
        """
        filepath = test_dir / "request.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        return filepath

    def save_events(self, test_dir: Path, events: List[SSEEvent]) -> Path:
        """Save all SSE events.

        Args:
            test_dir: Test output directory
            events: List of parsed SSE events

        Returns:
            Path to the saved file
        """
        filepath = test_dir / "events.json"
        events_data = []
        for event in events:
            event_dict = {
                "event_type": event.event_type,
                "action": event.action,
                "message": event.message,
                "timestamp": event.timestamp,
                "raw_data": event.raw_data,
            }
            events_data.append(event_dict)

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(events_data, f, indent=2, ensure_ascii=False)
        return filepath

    def save_app_config(self, test_dir: Path, config: Dict[str, Any]) -> Path:
        """Save the final app config.

        Args:
            test_dir: Test output directory
            config: The app configuration dictionary

        Returns:
            Path to the saved file
        """
        filepath = test_dir / "app_config.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return filepath

    def save_progress_log(self, test_dir: Path, events: List[SSEEvent]) -> Path:
        """Save a human-readable progress log.

        Args:
            test_dir: Test output directory
            events: List of parsed SSE events

        Returns:
            Path to the saved file
        """
        filepath = test_dir / "progress_log.txt"

        lines = []
        lines.append("=" * 60)
        lines.append("WORKFLOW PROGRESS LOG")
        lines.append("=" * 60)
        lines.append("")

        for event in events:
            timestamp_str = ""
            if event.timestamp:
                try:
                    dt = datetime.fromtimestamp(event.timestamp)
                    timestamp_str = dt.strftime("%H:%M:%S.%f")[:-3]
                except (ValueError, OSError):
                    timestamp_str = str(event.timestamp)

            event_type = event.event_type or "unknown"
            action = event.action or ""
            message = event.message or ""

            # Format based on event type
            if event_type == "progress":
                progress = event.raw_data.get("progress", "") if event.raw_data else ""
                eta = event.raw_data.get("estimated_time_to_complete", "") if event.raw_data else ""
                line = f"[{timestamp_str}] PROGRESS {progress}% | {action}: {message}"
                if eta and eta != -1:
                    line += f" (ETA: {eta}s)"
                lines.append(line)
            elif event_type == "chat_message":
                text = event.raw_data.get("text", message) if event.raw_data else message
                lines.append(
                    f"[{timestamp_str}] CHAT: {text[:200]}{'...' if len(str(text)) > 200 else ''}"
                )
            elif event_type == "app_config_updated":
                reload_app = event.raw_data.get("reload_app", False) if event.raw_data else False
                lines.append(f"[{timestamp_str}] CONFIG UPDATED (reload: {reload_app})")
            elif event_type == "page_reload":
                slug = event.raw_data.get("goto_page_slug", "") if event.raw_data else ""
                lines.append(f"[{timestamp_str}] PAGE RELOAD: {slug}")
            else:
                lines.append(f"[{timestamp_str}] {event_type.upper()}: {action} - {message}")

        lines.append("")
        lines.append("=" * 60)
        lines.append(f"Total events: {len(events)}")
        lines.append("=" * 60)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return filepath

    def save_validation_report(self, test_dir: Path, report: Dict[str, Any]) -> Path:
        """Save the validation report.

        Args:
            test_dir: Test output directory
            report: Validation report dictionary

        Returns:
            Path to the saved file
        """
        filepath = test_dir / "validation_report.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        return filepath

    def save_backend_response(self, test_dir: Path, response: Dict[str, Any]) -> Path:
        """Save the backend response data.

        This file contains the callback data that would normally be sent
        to the Django backend upon workflow completion.

        Args:
            test_dir: Test output directory
            response: The backend response/callback data

        Returns:
            Path to the saved file
        """
        filepath = test_dir / "backend_response.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(response, f, indent=2, ensure_ascii=False)
        return filepath

    def save_schema_validation(self, test_dir: Path, validation_result: Dict[str, Any]) -> Path:
        """Save the schema validation results.

        This file contains detailed schema validation results for the app_config,
        including all errors found during validation.

        Args:
            test_dir: Test output directory
            validation_result: Schema validation result dictionary

        Returns:
            Path to the saved file
        """
        filepath = test_dir / "schema_validation.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(validation_result, f, indent=2, ensure_ascii=False)
        return filepath

    def save_run_summary(self, run_dir: Path, results: List[Dict[str, Any]]) -> Path:
        """Save the overall run summary.

        Args:
            run_dir: Run output directory
            results: List of test results with name, passed, duration, etc.

        Returns:
            Path to the saved file
        """
        filepath = run_dir / "summary.json"

        total = len(results)
        passed = sum(1 for r in results if r.get("passed", False))
        failed = total - passed

        summary = {
            "timestamp": datetime.now().isoformat(),
            "total_tests": total,
            "passed": passed,
            "failed": failed,
            "pass_rate": f"{(passed/total*100):.1f}%" if total > 0 else "N/A",
            "tests": results,
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        return filepath
