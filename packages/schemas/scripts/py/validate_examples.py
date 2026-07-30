#!/usr/bin/env python3
"""
Validate all example app configs in data/examples/ against the schema.

Usage:
    python validate_examples.py

Exit code 1 on validation failure.
"""

import json
import os
import sys
from datetime import datetime

_current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _current_dir)

from validation import validate_app_config
from validation.scaffold import validate_scaffold_config, SCAFFOLD_TYPES

EXAMPLES_DIR = os.path.normpath(os.path.join(_current_dir, "..", "..", "data", "examples"))
REPORT_PATH = os.path.join(_current_dir, "examples_validation_report.txt")

SKIP_DIRECTORIES = {"logic_common", "backend"}

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
BOLD = "\033[1m"
RESET = "\033[0m"


def validate_scaffolds_in_config(data: dict) -> tuple[int, list[str], list[str]]:
    """
    Validate all scaffold components found in an app config's page content.

    Returns:
        (scaffolds_found, errors, warnings)
    """
    scaffold_errors: list[str] = []
    scaffold_warnings: list[str] = []
    scaffolds_found = 0

    frontend = data.get("frontend") or {}
    pages = frontend.get("pages") or []
    backend = data.get("backend") or {}
    backend_models = backend.get("models") or []
    backend_security = data.get("security")
    backend_agents = backend.get("agents") or []

    for page in pages:
        page_id = (
            page.get("pageId")
            or page.get("page_id")
            or page.get("slug")
            or page.get("title")
            or "unknown"
        )
        content = page.get("content") or []
        for component in content:
            if not isinstance(component, dict):
                continue
            ct = component.get("componentType", "")
            if ct not in SCAFFOLD_TYPES:
                continue

            scaffolds_found += 1
            result = validate_scaffold_config(
                component, backend_models, backend_security, backend_agents
            )

            for err in result.get("errors", []):
                if isinstance(err, dict) and err.get("severity") == "error":
                    scaffold_errors.append(
                        f"  scaffold {ct} on page '{page_id}': {err.get('message', '')}"
                    )

            for warn in result.get("warnings", []):
                if isinstance(warn, dict):
                    scaffold_warnings.append(
                        f"  scaffold {ct} on page '{page_id}': {warn.get('message', '')}"
                    )

    return scaffolds_found, scaffold_errors, scaffold_warnings


def walk_json_files(directory):
    results = []
    for entry in sorted(os.listdir(directory)):
        full_path = os.path.join(directory, entry)
        if os.path.isdir(full_path):
            if entry in SKIP_DIRECTORIES:
                continue
            results.extend(walk_json_files(full_path))
        elif entry.endswith(".json") and not entry.startswith("catalog_"):
            results.append(full_path)
    return results


def main():
    print(f"Validating example configs...")
    print(f"Directory: {EXAMPLES_DIR}\n")

    if not os.path.isdir(EXAMPLES_DIR):
        print(f"{RED}Error: directory not found: {EXAMPLES_DIR}{RESET}")
        sys.exit(1)

    files = walk_json_files(EXAMPLES_DIR)
    total_errors = 0
    total_warnings = 0
    total_scaffold_errors = 0
    total_scaffold_warnings = 0
    total_scaffolds_found = 0
    passed = 0
    failed = 0
    report_lines: list[str] = []

    for file_path in files:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            data = json.loads(content)
            is_webapp = (
                isinstance(data, dict)
                and "uuid" in data
                and "name" in data
                and "alias" in data
                and ("frontend" in data or "backend" in data)
            )
            if not is_webapp:
                continue

            result = validate_app_config(content, "WebAppProps")
            errors = result.get("errors", [])
            warnings = result.get("warnings", [])
            n_errors = len(errors)
            n_warnings = len(warnings) if isinstance(warnings, list) else 0
            total_warnings += n_warnings

            # Scaffold-specific validation
            scaffolds_found, scaffold_errors, scaffold_warnings = validate_scaffolds_in_config(data)
            total_scaffolds_found += scaffolds_found
            total_scaffold_errors += len(scaffold_errors)
            total_scaffold_warnings += len(scaffold_warnings)

            if n_errors == 0 and len(scaffold_errors) == 0:
                passed += 1
                status = f"{GREEN}[OK]{RESET} {file_path}"
                if scaffolds_found > 0 and scaffold_warnings:
                    status += f"  {YELLOW}({scaffolds_found} scaffold(s), {len(scaffold_warnings)} warning(s)){RESET}"
                elif scaffolds_found > 0:
                    status += f"  ({scaffolds_found} scaffold(s) valid)"
                print(status)
            else:
                failed += 1
                total_errors += n_errors
                print(f"{RED}[FAIL]{RESET} {file_path}")
                report_lines.append(f"FILE: {file_path}")
                if errors:
                    report_lines.append("SCHEMA ERRORS:")
                    for err in errors:
                        print(f"  {err}")
                        report_lines.append(f"  {err}")
                if scaffold_errors:
                    report_lines.append("SCAFFOLD ERRORS:")
                    for err in scaffold_errors:
                        print(f"  {err}")
                        report_lines.append(f"  {err}")
                if scaffold_warnings:
                    report_lines.append("SCAFFOLD WARNINGS:")
                    for warn in scaffold_warnings:
                        report_lines.append(f"  {warn}")
                report_lines.append("\n" + "-" * 80 + "\n")
                print()

        except Exception as e:
            failed += 1
            total_errors += 1
            print(f"{RED}[FAIL]{RESET} {file_path}")
            report_lines.append(f"FILE: {file_path}")
            report_lines.append(f"ERRORS:\n  Parse error: {e}")
            report_lines.append("\n" + "-" * 80 + "\n")
            print(f"  Parse error: {e}")
            print()

    total_files = passed + failed
    print()
    print("=" * 60)
    print(f"Results: {passed}/{total_files} files pass validation")
    print(f"Errors: {total_errors} | Warnings: {total_warnings}")
    if total_scaffolds_found > 0:
        print(
            f"Scaffolds: {total_scaffolds_found} found, "
            f"{total_scaffold_errors} error(s), "
            f"{total_scaffold_warnings} warning(s)"
        )
    print("=" * 60)

    if report_lines:
        scaffold_line = ""
        if total_scaffolds_found > 0:
            scaffold_line = (
                f"Scaffolds: {total_scaffolds_found} found | "
                f"{total_scaffold_errors} scaffold error(s) | "
                f"{total_scaffold_warnings} scaffold warning(s)\n"
            )
        header = (
            f"Validation Report — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"Directory: {EXAMPLES_DIR}\n"
            f"Results: {passed}/{total_files} pass | {total_errors} errors | {total_warnings} warnings\n"
            f"{scaffold_line}"
            f"{'=' * 60}\n\n"
        )
        with open(REPORT_PATH, "w", encoding="utf-8") as f:
            f.write(header)
            f.write("\n".join(report_lines))
        print(f"\nReport written to: {REPORT_PATH}")

    if total_errors > 0:
        print(f"\n{RED}{BOLD}Validation FAILED with {total_errors} error(s).{RESET}")
        sys.exit(1)
    else:
        print(f"\n{GREEN}{BOLD}All examples pass validation.{RESET}")


if __name__ == "__main__":
    main()
