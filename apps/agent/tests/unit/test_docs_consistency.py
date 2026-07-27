"""Consistency checks for checked-in documentation."""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
DOCS_ROOT = REPO_ROOT / "apps/agent/docs/latest"


def test_docs_latest_markdown_links_resolve():
    missing_links: list[tuple[str, str]] = []

    for markdown_file in sorted(DOCS_ROOT.glob("*.md")):
        text = markdown_file.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
            if target.startswith(("http://", "https://", "#")):
                continue

            resolved = markdown_file.parent / target
            if not resolved.exists():
                missing_links.append((markdown_file.name, target))

    assert not missing_links, f"Broken docs/latest links: {missing_links}"
