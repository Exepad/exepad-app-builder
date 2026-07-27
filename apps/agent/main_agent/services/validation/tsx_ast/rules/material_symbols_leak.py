"""``component.icons.material_symbols_leak`` — flag raw
``<span class="material-symbols-outlined">{glyph}</span>`` elements
that survived the design-import polish pass.

The bug this catches
--------------------

App ``rdzn62gx`` (2026-05-16, chick-farm Stitch import): Footer.tsx
shipped with three raw Material Symbols spans:
``<span className="material-symbols-outlined">potted_plant</span>``,
``egg``, ``grass``. The runtime does NOT load the Material Symbols
webfont, so the spans rendered the literal glyph names ("potted_plant",
"egg", "grass") as plain text in the footer. Meanwhile
``ApplicationForm.tsx`` in the same app correctly used
``<Icons.ArrowRight>`` from the SDK. The polish-mode ICON-SYSTEM rule
told the LLM "only migrate consistently"; the LLM read this as "skip
when already inconsistent" and left the spans alone.

Severity policy
---------------

**Error, unconditionally.** Earlier policy split severity based on
whether the file imported ``Icons`` from ``@exepad/sdk``, on the
theory that a no-``Icons``-import file was "legacy" and might want
plain Material Symbols. That theory was wrong: the runtime never loads
the Material Symbols webfont in any code path, so the glyph name
renders as plain text either way. App ``9vvnqllg`` (chick-farm4017,
2026-05-16) shipped a MainFooter with three glyphs leaking as plain
text on every page because the rule emitted warning-severity (no
``Icons`` import) and polish let it through. The paired auto-fixer
inserts the ``Icons`` import when it rewrites at least one glyph, so
the error is recoverable end-to-end.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import iter_jsx_opening_elements, jsx_attribute_string_value, jsx_tag_name
from .base import AstContext, Finding


class MaterialSymbolsLeakRule:
    """Flag raw ``material-symbols-outlined`` spans in component TSX."""

    id = "component.icons.material_symbols_leak"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        tree = ctx.tree
        if tree is None:
            return

        buf = ctx.source_buf
        imports_icons = _imports_icons_from_sdk(ctx.tsx)

        for element in iter_jsx_opening_elements(tree.root_node):
            tag = jsx_tag_name(element, buf)
            if tag != "span":
                continue
            class_str = jsx_attribute_string_value(element, "className", buf)
            if class_str is None:
                class_str = jsx_attribute_string_value(element, "class", buf)
            if class_str is None:
                continue
            tokens = class_str.split()
            if "material-symbols-outlined" not in tokens:
                continue

            line = element.start_point[0] + 1
            col = element.start_point[1]
            yield Finding(
                rule_id=self.id,
                severity="error",
                line=line,
                col=col,
                message=(
                    "Raw `<span class=\"material-symbols-outlined\">…</span>` — "
                    "the runtime does not load the Material Symbols webfont, "
                    "so the glyph name renders as plain text on every page. "
                    + (
                        "This file already imports `Icons` from `@exepad/sdk`; "
                        "mixed icon systems in one component are forbidden."
                        if imports_icons
                        else "Migrate to `<Icons.{PascalCase}/>` from "
                        "`@exepad/sdk` — the auto-fixer will also add the "
                        "import when it rewrites at least one glyph."
                    )
                ),
                fix_hint=(
                    "Replace each `<span class=\"material-symbols-outlined\">"
                    "{glyph}</span>` with `<Icons.{PascalCase}/>` "
                    "(snake_case → PascalCase). Common maps: "
                    "`chevron_right`→`ChevronRight`, `arrow_right`→`ArrowRight`, "
                    "`menu`→`Menu`, `close`→`X`, `egg`→`Egg`, `home`→`Home`, "
                    "`potted_plant`→`Sprout`, `grass`→`Sprout`. "
                    "For glyphs without a lucide equivalent, use the closest "
                    "semantic match (`Leaf`, `Sprout`, `Trees`, `Flower2`)."
                ),
            )


def _imports_icons_from_sdk(tsx: str) -> bool:
    """Return True when the source has ``Icons`` in a `from "@exepad/sdk"` import.

    Substring-match the SDK import line(s); enough to gate severity. The
    rule fires either way — severity adjusts.
    """
    for raw_line in tsx.splitlines():
        line = raw_line.strip()
        if "@exepad/sdk" not in line:
            continue
        if "Icons" in line and line.startswith(("import ", "import{")):
            return True
    return False
