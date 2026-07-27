"""Auto-fix: rewrite raw ``<span class="material-symbols-outlined">{glyph}</span>``
to ``<Icons.{PascalCase}/>`` from ``@exepad/sdk`` for the unambiguous
subset of glyphs we have lucide-react equivalents for.

The bug class
-------------

App ``rdzn62gx`` (2026-05-16, chick-farm Stitch import): Footer.tsx
shipped with three raw Material Symbols spans (`potted_plant`, `egg`,
`grass`). The runtime doesn't load the Material Symbols webfont; the
spans rendered the literal glyph name as plain text. The AST rule
``component.icons.material_symbols_leak`` catches the pattern; this
fixer auto-resolves the high-confidence subset so the agent doesn't
have to round-trip.

Scope
-----

The mapping table below is the **unambiguous** subset only — every
target is verified to exist in ``valid_lucide_icons.json`` (lucide's
catalogue is 3800+ icons, so coverage is conservative on purpose).
Unknown / ambiguous glyphs (e.g. ``potted_plant`` — closest match is
``Sprout`` or ``Flower2``; ``grass`` — closest is ``Leaf`` or
``Sprout``) are NOT auto-fixed; the AST rule emits a warning suggesting
candidates and the LLM picks on the next save.

Side effect: when the fixer rewrites at least one span, it also
ensures ``Icons`` appears in the ``@exepad/sdk`` import line — the
``component_imports`` fixer would add it on the next pass anyway, but
adding it locally keeps the pre/post diff coherent.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import structlog

from main_agent.services.validation._env import require_in_production
from main_agent.services.validation.fixers._context import FixContext

logger = structlog.get_logger(__name__)


# Snake-case glyph name → lucide-react PascalCase. Keep this list TIGHT
# — only add entries where the semantic match is obvious. Validated by
# the test suite: every value must be present in
# ``valid_lucide_icons.json``.
_GLYPH_MAP: dict[str, str] = {
    # Navigation / arrows
    "chevron_right": "ChevronRight",
    "chevron_left": "ChevronLeft",
    "chevron_up": "ChevronUp",
    "chevron_down": "ChevronDown",
    "arrow_right": "ArrowRight",
    "arrow_left": "ArrowLeft",
    "arrow_upward": "ArrowUp",
    "arrow_downward": "ArrowDown",
    "menu": "Menu",
    "close": "X",
    "more_horiz": "MoreHorizontal",
    "more_vert": "MoreVertical",
    # Actions
    "add": "Plus",
    "remove": "Minus",
    "delete": "Trash2",
    "edit": "Edit",
    "save": "Save",
    "search": "Search",
    "download": "Download",
    "upload": "Upload",
    "share": "Share2",
    "send": "Send",
    "refresh": "RefreshCw",
    "filter_alt": "Filter",
    # Communication
    "mail": "Mail",
    "email": "Mail",
    "phone": "Phone",
    "chat": "MessageCircle",
    "chat_bubble": "MessageSquare",
    "notifications": "Bell",
    # Location / map
    "map_pin": "MapPin",
    "location_on": "MapPin",
    "home": "Home",
    "globe": "Globe",
    "wifi": "Wifi",
    # User / account
    "person": "User",
    "people": "Users",
    "settings": "Settings",
    "logout": "LogOut",
    "login": "LogIn",
    "lock": "Lock",
    "lock_open": "Unlock",
    # State / feedback
    "check": "Check",
    "check_circle": "CheckCircle",
    "info": "Info",
    "error": "AlertCircle",
    "help": "HelpCircle",
    "visibility": "Eye",
    "visibility_off": "EyeOff",
    "favorite": "Heart",
    "star": "Star",
    "bookmark": "Bookmark",
    "shield": "Shield",
    # Time / calendar
    "calendar_today": "Calendar",
    "event": "Calendar",
    "schedule": "Clock",
    "access_time": "Clock",
    # Files / media
    "description": "FileText",
    "folder": "Folder",
    "image": "Image",
    "photo_camera": "Camera",
    "videocam": "Video",
    "music_note": "Music",
    "volume_up": "Volume2",
    "play_arrow": "Play",
    "pause": "Pause",
    "stop": "Square",
    # Tag / label
    "label": "Tag",
    # Weather / theme
    "light_mode": "Sun",
    "dark_mode": "Moon",
    "cloud": "Cloud",
    # Nature (chick_farm-shaped). chick-farm4017 (9vvnqllg, 2026-05-16)
    # MainFooter shipped `potted_plant`/`egg`/`grass` as plain text because
    # only `egg` was mapped.
    "egg": "Egg",
    "eco": "Leaf",
    "park": "Trees",
    "spa": "Flower2",
    "potted_plant": "Sprout",
    "grass": "Sprout",
    "nature": "Trees",
    "local_florist": "Flower",
    "yard": "Trees",
    "agriculture": "Wheat",
}


# Match `<span ... className="..." ...>{glyph}</span>` — but be careful
# to only match when the className contains the `material-symbols-outlined`
# token. We rebuild the source ourselves rather than regex-replace
# because the className may have other tokens (sizing, color) we want to
# carry into the Icon's `className` prop.
_SPAN_RE = re.compile(
    r"<span([^>]*?)>\s*([a-z0-9_]+)\s*</span>",
    re.IGNORECASE,
)

_CLASSNAME_RE = re.compile(r'className\s*=\s*"([^"]*)"')

_VALID_LUCIDE_PATH = (
    Path(__file__).resolve().parents[2]
    / "validation"
    / "valid_lucide_icons.json"
)


def _load_valid_lucide() -> frozenset[str]:
    """Load + cache the lucide allowlist.

    - **Dev/self-host:** missing/unreadable → empty set; the fixer
      becomes a silent no-op (a contributor without the committed asset
      can still run).
    - **Production:** missing/unreadable raises
      :class:`ProductionDependencyMissing`. The file is committed in the
      agent source tree, so a missing load means the source tree / image
      is broken — failing loud beats shipping a silently disabled fixer
      (the ``ze1ltmf9`` failure mode)."""
    try:
        with open(_VALID_LUCIDE_PATH, encoding="utf-8") as f:
            return frozenset(json.load(f))
    except (OSError, json.JSONDecodeError):
        require_in_production(
            dependency="valid_lucide_icons.json",
            hint=(
                "This file is committed at "
                "apps/agent/main_agent/services/validation/valid_lucide_icons.json. "
                "If it's missing the source tree is broken — rebuild the "
                "agent container."
            ),
        )
        logger.warning("valid_lucide_icons.json not loadable — icon fixer disabled")
        return frozenset()


_VALID_LUCIDE = _load_valid_lucide()


# ---------------------------------------------------------------------------
# R6 — Tailwind text-{size} → lucide w-/h- sizing translation.
#
# Material Symbols are a font; the source HTML routinely sized them with
# ``text-6xl``/``text-[30rem]``. Polish converts the spans to ``<Icons.X>``,
# but lucide SVGs ignore font-size — the icon renders at the default 24×24
# regardless. App ``9vvnqllg`` (chick-farm4017, 2026-05-16): HomeContent
# ``<Icons.Egg className="text-[30rem] leading-none" />`` decorative
# watermark, ContactUsContent ``<Icons.MapPin className="text-6xl ..." />``,
# OurProductsContent ``<Icons.Leaf className="text-[160px] ..." />``,
# AboutUsContent ``<Icons.Heart className="text-on-tertiary-container" />``
# — all four ended up 24×24 instead of their intended sizes.
# ---------------------------------------------------------------------------

# Tailwind's default font-size scale → roughly equivalent w-/h- box sizes.
# We err slightly LARGER than the matching text size because lucide SVGs
# include intrinsic padding and need that headroom to read at the same
# visual weight as the original glyph.
_TEXT_SIZE_TO_WH: dict[str, str] = {
    "text-xs": "w-3 h-3",
    "text-sm": "w-4 h-4",
    "text-base": "w-4 h-4",
    "text-lg": "w-5 h-5",
    "text-xl": "w-6 h-6",
    "text-2xl": "w-7 h-7",
    "text-3xl": "w-8 h-8",
    "text-4xl": "w-10 h-10",
    "text-5xl": "w-12 h-12",
    "text-6xl": "w-16 h-16",
    "text-7xl": "w-20 h-20",
    "text-8xl": "w-24 h-24",
    "text-9xl": "w-32 h-32",
}

# Arbitrary-value text-[Nunit] → w-[Nunit] h-[Nunit]. Match number + unit.
_TEXT_ARBITRARY_SIZE_RE = re.compile(r"^text-\[(\d+(?:\.\d+)?(?:rem|px|em))\]$")

# Match `<Icons.{Name} ...>` opening tags (self-closing or not). The
# `Name` capture is intentionally loose — we don't care which lucide
# icon, only that it's the Icons.* namespace; coupled with a className
# attribute check, the false-positive risk is near zero.
_ICONS_OPEN_RE = re.compile(
    r'(<Icons\.[A-Z][A-Za-z0-9_]*\b)([^>]*?)(/?>)',
)


def _is_lucide_size_token(tok: str) -> str | None:
    """Return the equivalent ``w-X h-X`` token pair, or None if ``tok`` is
    not a font-size class. Color tokens (``text-primary``, ``text-white``,
    ``text-red-500``) return None."""
    pair = _TEXT_SIZE_TO_WH.get(tok)
    if pair is not None:
        return pair
    m = _TEXT_ARBITRARY_SIZE_RE.match(tok)
    if m is None:
        return None
    size = m.group(1)
    return f"w-[{size}] h-[{size}]"


def _has_explicit_sizing(tokens: list[str]) -> bool:
    """True when the className already carries a width or height utility.

    Matches `w-`, `h-`, `size-` (Tailwind shorthand for both) — any value
    including arbitrary `[...]`. We're conservative: if the agent has
    *any* sizing already, we leave the className alone.
    """
    for t in tokens:
        bare = t.split(":")[-1]  # strip variants like `md:`/`hover:`
        if (
            bare.startswith("w-")
            or bare.startswith("h-")
            or bare.startswith("size-")
            or bare == "w-full"
            or bare == "h-full"
        ):
            return True
    return False


def _apply_lucide_sizing_translation(
    tsx: str, fixes_applied: list[str]
) -> str:
    """Replace ``<Icons.X className="text-Nxl ...">`` with sized variants.

    For each ``<Icons.*>`` whose className carries a font-size utility
    AND no explicit ``w-``/``h-``/``size-`` class: swap the font-size
    token out for the equivalent ``w-N h-N`` pair. Color text-* classes
    (``text-primary``/``text-white``/etc.) are left untouched.
    """
    if "<Icons." not in tsx:
        return tsx

    out_parts: list[str] = []
    cursor = 0
    for match in _ICONS_OPEN_RE.finditer(tsx):
        head = match.group(1)
        attrs = match.group(2)
        tail = match.group(3)
        cls_match = _CLASSNAME_RE.search(attrs)
        if cls_match is None:
            continue
        tokens = cls_match.group(1).split()
        if _has_explicit_sizing(tokens):
            continue

        # Find the first font-size token (rare to have more than one).
        new_tokens: list[str] = []
        wh_pair: str | None = None
        for tok in tokens:
            translated = _is_lucide_size_token(tok)
            if translated is not None and wh_pair is None:
                wh_pair = translated
                continue  # drop the font-size token
            new_tokens.append(tok)
        if wh_pair is None:
            continue

        # Lead with sizing so it's visually obvious in the diff.
        new_tokens = wh_pair.split() + new_tokens
        new_classname = " ".join(new_tokens)
        rebuilt_attrs = (
            attrs[: cls_match.start(1) - len('"')]
            + f'"{new_classname}"'
            + attrs[cls_match.end(1) + len('"') :]
        )
        # Splice rebuilt fragment back into output.
        out_parts.append(tsx[cursor : match.start()])
        out_parts.append(head + rebuilt_attrs + tail)
        cursor = match.end()
        fixes_applied.append(
            f"Sized lucide icon {head[len('<'):]} — translated font-size "
            f"to {wh_pair} (lucide SVGs ignore text-* sizing)"
        )
    if cursor == 0:
        return tsx
    out_parts.append(tsx[cursor:])
    return "".join(out_parts)


def apply_component_icons_fixes(
    tsx: str, _ctx: FixContext, fixes_applied: list[str]
) -> str:
    """Rewrite mappable raw Material Symbols spans to ``<Icons.X />``.

    Conservative: only rewrites the spans whose glyph is in ``_GLYPH_MAP``
    AND whose target name appears in ``valid_lucide_icons.json``. Unknown
    glyphs are left alone (the AST rule's warning carries the suggestion).
    """
    if "material-symbols-outlined" not in tsx:
        return tsx

    replacements: list[tuple[int, int, str]] = []
    pre_count = len(fixes_applied)

    for match in _SPAN_RE.finditer(tsx):
        attrs = match.group(1)
        glyph = match.group(2).strip()
        cls_match = _CLASSNAME_RE.search(attrs)
        if not cls_match:
            continue
        tokens = cls_match.group(1).split()
        if "material-symbols-outlined" not in tokens:
            continue

        icon_name = _GLYPH_MAP.get(glyph.lower())
        if icon_name is None:
            continue
        if _VALID_LUCIDE and icon_name not in _VALID_LUCIDE:
            # Lucide drift — don't ship a runtime-unknown icon name.
            continue

        # Drop the marker token; keep other classes (sizing, color).
        other_classes = [t for t in tokens if t != "material-symbols-outlined"]
        # Also drop the className attribute itself if it would become empty.
        if other_classes:
            new_class = " ".join(other_classes)
            replacement = f'<Icons.{icon_name} className="{new_class}" />'
        else:
            replacement = f"<Icons.{icon_name} />"
        replacements.append((match.start(), match.end(), replacement))
        fixes_applied.append(
            f"Replaced raw <span material-symbols-outlined>{glyph}</span> → "
            f"<Icons.{icon_name}/>"
        )

    if not replacements:
        # Even without a span→Icons rewrite, run the lucide-sizing pass:
        # `<Icons.X className="text-6xl ..." />` patterns survive from
        # earlier polish turns and still need w-/h- translation.
        return _apply_lucide_sizing_translation(tsx, fixes_applied)

    # Apply right-to-left so earlier indices stay valid.
    replacements.sort(key=lambda r: r[0], reverse=True)
    out = tsx
    for start, end, rep in replacements:
        out = out[:start] + rep + out[end:]

    # Ensure `Icons` is in the SDK import. The component_imports fixer
    # would add it on the next pass anyway, but doing it locally keeps
    # the diff coherent for this fixer's slot.
    out = _ensure_icons_imported(out)

    # Run the lucide-sizing translation pass on the rewritten source so
    # the new `<Icons.X>` tags created above (which inherited their span's
    # `text-*` classes) also get explicit w-/h- sizing.
    out = _apply_lucide_sizing_translation(out, fixes_applied)

    if len(fixes_applied) > pre_count:
        return out
    return tsx


def _ensure_icons_imported(tsx: str) -> str:
    """Append ``Icons`` to the existing ``@exepad/sdk`` import when absent.

    No-op when the file has no SDK import line (the imports fixer will
    add a full import block separately) or when `Icons` is already there.
    """
    import_re = re.compile(
        r'(import\s*\{\s*)([^}]*)(\s*\}\s*from\s*[\'"]@exepad/sdk[\'"])'
    )
    match = import_re.search(tsx)
    if not match:
        return tsx
    members = [m.strip() for m in match.group(2).split(",") if m.strip()]
    if "Icons" in members:
        return tsx
    members.append("Icons")
    new_block = f"{match.group(1)}{', '.join(members)}{match.group(3)}"
    return tsx.replace(match.group(0), new_block, 1)
