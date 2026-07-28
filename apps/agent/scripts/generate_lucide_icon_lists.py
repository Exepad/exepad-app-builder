"""
generate_lucide_icon_lists.py

Regenerates `apps/agent/main_agent/services/validation/valid_lucide_icons.json`
from the lucide-react `dynamicIconImports` map shipped in node_modules.

Run from the repo root:
    python3 apps/agent/scripts/generate_lucide_icon_lists.py

Why we need this: the SDK's `Icons` Proxy (curated-icons.ts) lazy-loads any
of lucide's ~1,912 icons by PascalCase name at runtime. The validator's
allowlist must mirror what the runtime accepts — otherwise the agent rejects
valid names like `Icons.Briefcase` even though they would render fine.

Replaces the previous hand-edited workflow. CLAUDE.md's stale instruction to
"regenerate" finally has a tool.
"""

from __future__ import annotations

import glob
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
LUCIDE_GLOB = (
    REPO_ROOT
    / "node_modules"
    / ".pnpm"
    / "lucide-react@*"
    / "node_modules"
    / "lucide-react"
    / "dist"
    / "esm"
    / "dynamicIconImports.js"
)
VALID_ICONS_JSON = (
    REPO_ROOT
    / "apps"
    / "agent"
    / "main_agent"
    / "services"
    / "validation"
    / "valid_lucide_icons.json"
)

KEY_RE = re.compile(r'"([a-z0-9-]+)":\s*\(\)\s*=>\s*import')


def _kebab_to_pascal(kebab: str) -> str:
    """`bar-chart-2` → `BarChart2`. Empty segments are skipped (defensive)."""
    return "".join(
        part[0].upper() + part[1:] if part else "" for part in kebab.split("-")
    )


def _find_dynamic_imports_file() -> Path:
    matches = sorted(glob.glob(str(LUCIDE_GLOB)))
    if not matches:
        raise SystemExit(
            f"lucide-react/dynamicIconImports.js not found under {LUCIDE_GLOB}.\n"
            "Run `pnpm install` from the repo root first."
        )
    # Take the highest version if multiple are installed.
    return Path(matches[-1])


def main() -> int:
    src_file = _find_dynamic_imports_file()
    src = src_file.read_text(encoding="utf-8")
    kebab_keys = KEY_RE.findall(src)
    if not kebab_keys:
        raise SystemExit(
            f"Failed to parse any icon keys from {src_file}.\n"
            "The lucide-react file format may have changed; update KEY_RE."
        )

    # Build the allowlist: each lucide name appears in PascalCase + `Icon`-suffixed
    # alias. Both forms resolve to the same component in lucide-react's React
    # entry, so the agent's existing IconsUnknownRule and apply_icon_fallback_only
    # check against either spelling.
    pascal_names: set[str] = set()
    for kebab in kebab_keys:
        pascal = _kebab_to_pascal(kebab)
        pascal_names.add(pascal)
        pascal_names.add(f"{pascal}Icon")

    allowlist = sorted(pascal_names)

    # Match the existing single-line JSON-array shape so diffs are minimal
    # when this file is committed.
    VALID_ICONS_JSON.write_text(json.dumps(allowlist), encoding="utf-8")

    unique_icons = len({n for n in allowlist if not n.endswith("Icon")})
    print(
        f"Wrote {VALID_ICONS_JSON} with {len(allowlist)} entries "
        f"({unique_icons} unique × {{bare, IconSuffix}}) "
        f"from {len(kebab_keys)} lucide kebab keys."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
