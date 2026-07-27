"""Fail fast when validation-confidence coverage drops below required thresholds."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("coverage_json", type=Path)
    parser.add_argument("--line-threshold", type=float, default=85.0)
    parser.add_argument("--branch-threshold", type=float, default=70.0)
    args = parser.parse_args()

    payload = json.loads(args.coverage_json.read_text(encoding="utf-8"))
    totals = payload.get("totals", {})
    line_rate = float(totals.get("percent_covered", 0.0))
    branch_rate = float(totals.get("percent_covered_display", line_rate))

    files = payload.get("files", {})
    total_branches = sum(
        file_data.get("summary", {}).get("num_branches", 0) for file_data in files.values()
    )
    covered_branches = sum(
        file_data.get("summary", {}).get("covered_branches", 0) for file_data in files.values()
    )
    if total_branches:
        branch_rate = (covered_branches / total_branches) * 100.0

    failures = []
    if line_rate < args.line_threshold:
        failures.append(
            f"line coverage {line_rate:.2f}% is below required {args.line_threshold:.2f}%"
        )
    if branch_rate < args.branch_threshold:
        failures.append(
            f"branch coverage {branch_rate:.2f}% is below required {args.branch_threshold:.2f}%"
        )

    if failures:
        for failure in failures:
            print(f"VALIDATION COVERAGE FAILURE: {failure}", file=sys.stderr)
        return 1

    print(
        "Validation coverage OK: "
        f"line={line_rate:.2f}% branch={branch_rate:.2f}% "
        f"(thresholds {args.line_threshold:.2f}% / {args.branch_threshold:.2f}%)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
