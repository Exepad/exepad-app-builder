"""URL and image rewrites for component TSX auto-fix.

Covers:
- Icon fuzzy-match (Icons.* → closest known lucide name, or Circle fallback).
- Hallucinated URL replacement in three shapes: ``<img src>`` tags, JS
  array ``image|src|photo|...`` properties, and CSS ``url(...)`` values.
- Static ``<img src>`` inside ``.map()`` blocks rewritten to use the map
  callback parameter.
- Raw ``<img>`` with placeholder/empty src converted to ``<ExepadImage>``.
- ``<ExepadImage>`` prop normalisation (keywords, importance, width/height).

**AST migration status (Change J):**

* Hallucinated ``<img src>`` URL replacement walks tree-sitter JSX img
  elements via :class:`JsxAstMutator`. Replaces the legacy
  ``re.sub(r"<img\\b[^>]*?>", ...)`` over raw TSX, which would in
  principle match ``<img>`` text in JSDoc comments.
* Hallucinated URLs in JS array-literal pairs walk ``pair`` nodes whose
  key matches the image-property allowlist. Replaces the legacy
  ``re.sub`` over raw TSX, which would match ``image: "url"`` text in
  comments.
* The icon-rescue helper (``apply_icon_fallback_only``) deliberately
  stays as a regex over raw TSX so it can run as a Tier B fallback on
  possibly-corrupted JSX. Comment-rewriting of ``Icons.X`` references is
  a documented trade-off — see :func:`apply_icon_fallback_only`.
* The static-img-in-map fixer is paren-balanced AST-aware (per
  ``project_scope_blind_map_img_fixer``).
* The CSS ``url(...)`` and baked-URL ``/a/.../repo/`` rewrites operate
  on shapes that don't cross JSX boundaries by construction (URL syntax
  is constrained); they keep regex with justifying comments.
"""

from __future__ import annotations

import re
from difflib import get_close_matches

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.semantic_validator import (
    _EXEPAD_IMAGE_TAG_RE,
    _VALID_LUCIDE_ICONS,
    _add_sdk_import,
    _is_image_domain_allowed,
    _is_image_domain_blocked,
    EXEPAD_IMAGE_FALLBACK_KEYWORDS,
)
from main_agent.services.validation.tsx_ast.mutator import JsxAstMutator
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import (
    find_by_type,
    iter_jsx_opening_elements,
    jsx_attribute_value_node,
    jsx_tag_name,
    string_literal_value,
)

# Image-property keys the array-image URL rewriter looks at. Centralized
# so the AST walker has a single source of truth instead of a regex
# alternation.
_IMAGE_KEY_NAMES = frozenset(
    {
        "image",
        "src",
        "photo",
        "avatar",
        "thumbnail",
        "cover",
        "picture",
        "img",
        "logo",
        "icon",
        "banner",
        "background",
        "backgroundimage",
    }
)

_RAW_IMG_PLACEHOLDER_RE = re.compile(
    r'<img\b([^>]*?)src=["\'](?:__PLACEHOLDER__|)["\']([^>]*?)/>',
    re.IGNORECASE | re.DOTALL,
)


def _fix_raw_img_to_exepad_image(tsx: str, fixes_applied: list[str]) -> str:
    """Convert raw <img> tags with placeholder src to <ExepadImage> components.

    Only converts tags with __PLACEHOLDER__ or empty src. Tags with real URLs
    (allowed domains) are left as-is.

    Also adds ``ExepadImage`` to the ``@exepad/sdk`` import list when at
    least one tag is converted. component_imports runs BEFORE this fixer
    in the dispatcher, so its missing-SDK-import scan misses the
    ``ExepadImage`` we just introduced; without this inline import-add,
    the first pass ships TSX with an unimported JSX tag that crashes at
    module load time. The second pass would catch it (component_imports
    re-running), but every fixer must be output-correct on a single
    pass to keep ``apply_auto_fixes`` idempotent.
    """
    converted_count = 0

    def _convert(m: re.Match) -> str:
        nonlocal converted_count
        before_src = m.group(1)
        after_src = m.group(2)
        rest = before_src + after_src

        # Extract alt text to use as keywords
        alt_m = re.search(r"""alt=["']([^"']+)["']""", rest)
        alt = alt_m.group(1) if alt_m else EXEPAD_IMAGE_FALLBACK_KEYWORDS
        # Remove alt from rest since it becomes keywords
        if alt_m:
            rest = rest.replace(alt_m.group(0), "")

        # Clean up className — keep it
        cls_m = re.search(r'className="([^"]*)"', rest)
        cls_attr = f' className="{cls_m.group(1)}"' if cls_m else ""

        converted_count += 1
        fixes_applied.append(f"Converted raw <img> to <ExepadImage> (keywords: {alt[:40]})")
        return f'<ExepadImage keywords="{alt}" importance={{5}}{cls_attr} />'

    rewritten = _RAW_IMG_PLACEHOLDER_RE.sub(_convert, tsx)
    if converted_count:
        rewritten = _add_sdk_import(rewritten, "ExepadImage")
    return rewritten


def _fix_exepad_image_props(tsx: str, fixes_applied: list[str]) -> str:
    """Normalize ExepadImage prop syntax and inject missing defaults.

    - Missing keywords → derive from alt prop or fallback to generic descriptors
    - keywords={"text"} / keywords={'text'} → keywords="text"
    - Missing importance → importance={5}
    """

    def _normalize_tag(m: re.Match) -> str:
        props = m.group(1)
        original_props = props

        # Skip keyword/importance injection for spread-based tags — keywords come
        # from the spread object (e.g., <ExepadImage {...item.image} />).
        has_spread = re.search(r"\{\.\.\.", props)

        # Inject missing keywords from alt prop or fallback.
        # Match ANY form of `keywords=` (static string, {"..."}, {`template`},
        # {identifier}, {fn()}) so we never double-inject.
        if not has_spread and not re.search(r"(?<![\w$-])keywords\s*=", props):
            alt_m = re.search(r"""alt=\{?["']([^"']+)["']\}?""", props)
            kw = alt_m.group(1) if alt_m else EXEPAD_IMAGE_FALLBACK_KEYWORDS
            props = f' keywords="{kw}"' + props
            fixes_applied.append(
                f"Injected missing ExepadImage keywords "
                f"from {'alt' if alt_m else 'fallback'}: {kw[:40]}"
            )

        # Normalize keywords={"text"} or keywords={'text'} → keywords="text"
        kw_jsx = re.search(r"""keywords=\{["']([^"']+)["']\}""", props)
        if kw_jsx:
            props = props.replace(kw_jsx.group(0), f'keywords="{kw_jsx.group(1)}"')

        # Pad short keywords (< 5 words) with generic descriptors (skip for spread tags)
        if not has_spread:
            kw_match = re.search(r"""keywords=["']([^"']+)["']""", props)
            if kw_match:
                kw_val = kw_match.group(1)
                if len(kw_val.split()) < 5:
                    padded = kw_val + " with detailed scene and natural lighting"
                    props = props.replace(kw_match.group(0), f'keywords="{padded}"')
                    fixes_applied.append(
                        f"Padded short ExepadImage keywords ({len(kw_val.split())} words) "
                        f"to meet 5-word minimum: {padded[:40]}"
                    )

        # Inject importance={5} if missing (skip for spread-based tags)
        if not has_spread and not re.search(r"importance=\{", props):
            props = props.rstrip() + " importance={5} "

        # Inject / cap width + height for CLS prevention (skip for spread-based tags).
        # Without explicit dimensions the browser reflows when the image loads,
        # and requests larger than 1200 waste LCP budget on mobile.
        if not has_spread:
            w_match = re.search(r"\bwidth=\{(\d+)\}", props)
            if not w_match:
                props = props.rstrip() + " width={800} "
                fixes_applied.append("Injected default ExepadImage width={800} (mobile-first)")
            elif int(w_match.group(1)) > 1200:
                old_w = w_match.group(0)
                props = props.replace(old_w, "width={1200}")
                fixes_applied.append(
                    f"Capped oversized ExepadImage {old_w} → width={{1200}} (mobile-first cap)"
                )

            h_match = re.search(r"\bheight=\{(\d+)\}", props)
            if not h_match:
                props = props.rstrip() + " height={600} "
                fixes_applied.append("Injected default ExepadImage height={600} (mobile-first)")
            elif int(h_match.group(1)) > 1200:
                old_h = h_match.group(0)
                props = props.replace(old_h, "height={1200}")
                fixes_applied.append(
                    f"Capped oversized ExepadImage {old_h} → height={{1200}} (mobile-first cap)"
                )

        if props != original_props:
            return f"<ExepadImage{props}/>"
        return m.group(0)

    result = _EXEPAD_IMAGE_TAG_RE.sub(_normalize_tag, tsx)
    if result != tsx:
        fixes_applied.append(
            "Normalized ExepadImage props (JSX expression syntax / missing importance)"
        )
    return result


def _find_matching_close_paren(tsx: str, open_paren_idx: int) -> int | None:
    """Return index of the ``)`` that matches ``(`` at ``open_paren_idx``.

    Tracks paren depth while skipping over string literals (``'``, ``"``, ``
    ` ``) and line/block comments. Returns ``None`` if no match is found.
    """
    if open_paren_idx >= len(tsx) or tsx[open_paren_idx] != "(":
        return None
    depth = 0
    in_string: str | None = None
    in_line_comment = False
    in_block_comment = False
    i = open_paren_idx
    n = len(tsx)
    while i < n:
        ch = tsx[i]
        nxt = tsx[i + 1] if i + 1 < n else ""
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == in_string:
                in_string = None
            i += 1
            continue
        if ch == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue
        if ch in ("'", '"', "`"):
            in_string = ch
            i += 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


# Matches ``<identifier>.map(`` — captures the source-array identifier. The
# array must be a bare identifier (e.g. ``features.map(``); inline array
# literals (``[...].map(``) are intentionally not captured because there is
# no named source array to inject ``image: "__PLACEHOLDER__"`` into, and the
# element type for an inline string array isn't an object anyway.
_NAMED_MAP_CALL_RE = re.compile(r"(?<![\w$])(\w+)\.map\s*\(")

# Static ``<img src="...">`` — rewrites to ``src={param.image}``.
_STATIC_IMG_SRC_RE = re.compile(
    r'(<img\b[^>]*?)src=["\']([^"\']+)["\']',
    re.IGNORECASE,
)

# Opening of the callback body — optional paren, then the first param name.
_MAP_CALLBACK_PARAM_RE = re.compile(r"^\s*\(?\s*(\w+)")


def _rewrite_static_img_src_in_map_callbacks(
    tsx: str, fixes_applied: list[str], provider_configured: bool = True
) -> str:
    """Rewrite ``<img src="...">`` to ``src={param.image}`` **only inside**
    the actual ``.map()`` callback span (paren-balanced), and inject
    ``image: "__PLACEHOLDER__"`` into every top-level object in the source
    array so the downstream image resolver has a slot to populate.

    The previous implementation used a 3000-char text window which leaked
    across the callback boundary and injected undeclared references into
    sibling JSX, producing runtime ReferenceErrors.

    When ``provider_configured`` is False, a real static URL is KEPT
    verbatim (goal #1) — only genuine ``__PLACEHOLDER__`` slots are
    converted to per-row dynamic src (and resolved to keyless Picsum).
    With a provider, every static src is converted so each row resolves to
    a unique stock image.
    """
    # Phase 1: collect rewrites without mutating the string so finditer
    # positions remain valid. Mutations are applied in reverse below.
    mutations: list[tuple[int, int, str]] = []  # (start, end, replacement)
    arrays_needing_image: list[str] = []

    for map_m in _NAMED_MAP_CALL_RE.finditer(tsx):
        array_name = map_m.group(1)
        open_paren = map_m.end() - 1
        close_paren = _find_matching_close_paren(tsx, open_paren)
        if close_paren is None:
            continue
        body_start = open_paren + 1
        body = tsx[body_start:close_paren]

        param_m = _MAP_CALLBACK_PARAM_RE.match(body)
        if not param_m:
            continue
        param_name = param_m.group(1)

        def _rewrite_src(m: "re.Match", _param: str = param_name) -> str:
            url = m.group(2)
            # No keyword-search provider → keep a real static URL (goal #1);
            # only convert a genuine __PLACEHOLDER__ slot to per-row dynamic.
            if provider_configured or url == "__PLACEHOLDER__":
                return f"{m.group(1)}src={{{_param}.image}}"
            return m.group(0)

        new_body = _STATIC_IMG_SRC_RE.sub(_rewrite_src, body)
        if new_body == body:
            continue

        mutations.append((body_start, close_paren, new_body))
        arrays_needing_image.append(array_name)
        fixes_applied.append(
            f"Replaced static <img src> inside .map() with src={{{param_name}.image}}"
        )

    # Apply mutations in reverse so earlier offsets remain valid.
    for start, end, replacement in reversed(mutations):
        tsx = tsx[:start] + replacement + tsx[end:]

    # Phase 2: inject ``image: "__PLACEHOLDER__"`` into each source array
    # that we just rewrote references for. Without this, the rendered
    # ``<img src={param.image}>`` reads ``undefined`` at runtime and the
    # image resolver has no slot to fill.
    for array_name in arrays_needing_image:
        tsx = _inject_image_placeholder_into_array(tsx, array_name, fixes_applied)

    return tsx


# Matches ``const <name> = [`` / ``let`` / ``var`` — captures the opening
# bracket position so we can paren-balance into the array body.
_ARRAY_DECL_RE_TEMPLATE = r"(?:const|let|var)\s+{name}\s*(?::[^=]+)?=\s*\["


def _find_matching_close_bracket(tsx: str, open_bracket_idx: int) -> int | None:
    """Return index of ``]`` matching ``[`` at ``open_bracket_idx``, skipping
    string literals and comments."""
    if open_bracket_idx >= len(tsx) or tsx[open_bracket_idx] != "[":
        return None
    depth = 0
    in_string: str | None = None
    in_line_comment = False
    in_block_comment = False
    i = open_bracket_idx
    n = len(tsx)
    while i < n:
        ch = tsx[i]
        nxt = tsx[i + 1] if i + 1 < n else ""
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == in_string:
                in_string = None
            i += 1
            continue
        if ch == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue
        if ch in ("'", '"', "`"):
            in_string = ch
            i += 1
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def _iter_top_level_object_spans(array_body: str):
    """Yield ``(start, end)`` offsets for each top-level ``{...}`` object
    literal in an array body. Nested objects/arrays and strings are skipped.
    """
    depth_bracket = 0  # nested arrays inside the top array
    depth_brace = 0
    obj_start: int | None = None
    in_string: str | None = None
    in_line_comment = False
    in_block_comment = False
    i = 0
    n = len(array_body)
    while i < n:
        ch = array_body[i]
        nxt = array_body[i + 1] if i + 1 < n else ""
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_string:
            if ch == "\\":
                i += 2
                continue
            if ch == in_string:
                in_string = None
            i += 1
            continue
        if ch == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue
        if ch in ("'", '"', "`"):
            in_string = ch
            i += 1
            continue
        if ch == "[":
            depth_bracket += 1
        elif ch == "]":
            depth_bracket -= 1
        elif ch == "{":
            if depth_bracket == 0 and depth_brace == 0:
                obj_start = i
            depth_brace += 1
        elif ch == "}":
            depth_brace -= 1
            if depth_bracket == 0 and depth_brace == 0 and obj_start is not None:
                yield (obj_start, i + 1)
                obj_start = None
        i += 1


_HAS_IMAGE_KEY_RE = re.compile(
    r"""(?:^|[,{\s])(image|src|photo|avatar|thumbnail|cover|picture|img)\s*:""",
    re.IGNORECASE,
)


def _inject_image_placeholder_into_array(
    tsx: str, array_name: str, fixes_applied: list[str]
) -> str:
    """Add ``image: "__PLACEHOLDER__"`` to each object in ``const <array_name> = [...]``
    that does not already have an image-like key.

    Paren-balances the array body, iterates top-level object literals, and
    rewrites objects missing the key in-place. Mutations are applied in
    reverse to keep earlier offsets valid.
    """
    decl_re = re.compile(_ARRAY_DECL_RE_TEMPLATE.format(name=re.escape(array_name)))
    decl_match = decl_re.search(tsx)
    if not decl_match:
        return tsx  # source array isn't a top-level identifier — silently skip

    open_bracket = decl_match.end() - 1  # position of the '['
    close_bracket = _find_matching_close_bracket(tsx, open_bracket)
    if close_bracket is None:
        return tsx

    body_start = open_bracket + 1
    body = tsx[body_start:close_bracket]

    injected = 0
    # Collect absolute offsets into tsx for in-place mutation.
    mutations: list[tuple[int, int, str]] = []
    for rel_start, rel_end in _iter_top_level_object_spans(body):
        obj_text = body[rel_start:rel_end]
        if _HAS_IMAGE_KEY_RE.search(obj_text):
            continue
        # Insert ``image: "__PLACEHOLDER__", `` right after the opening ``{``.
        new_obj = '{ image: "__PLACEHOLDER__", ' + obj_text[1:]
        abs_start = body_start + rel_start
        abs_end = body_start + rel_end
        mutations.append((abs_start, abs_end, new_obj))
        injected += 1

    for start, end, replacement in reversed(mutations):
        tsx = tsx[:start] + replacement + tsx[end:]

    if injected:
        fixes_applied.append(
            f'Injected image: "__PLACEHOLDER__" into {injected} object(s) '
            f"of {array_name} data array"
        )
    return tsx


# Semantic aliases for LLM-hallucinated icon names that have no string-close
# match in Lucide's catalogue. Each value MUST be a real Lucide name (verified
# at module load below; missing entries are stripped silently to keep the fixer
# robust against future Lucide version changes).
_ICON_SEMANTIC_ALIASES: dict[str, str] = {
    "Tool": "Wrench",
    "Tools": "Wrench",
    "Email": "Mail",
    "Envelope": "Mail",
    "Photo": "Image",
    "Picture": "Image",
    "Add": "Plus",
    "Remove": "Minus",
    "Configure": "Settings",
    "Gear": "Settings",
    "Cog2": "Cog",
    "Trash": "Trash2",
    "Delete": "Trash2",
    "Garbage": "Trash2",
    "Profile": "User",
    "Person": "User",
    "Account": "User",
    "Document": "FileText",
    "File2": "File",
    "Chart": "BarChart3",
    "Graph": "BarChart3",
    "Cart": "ShoppingCart",
    "Basket": "ShoppingBag",
    "Login": "LogIn",
    "Logout": "LogOut",
    "Signin": "LogIn",
    "Signout": "LogOut",
    "Like": "Heart",
    "Favorite": "Star",
    "Bookmark2": "Bookmark",
    "Reply": "CornerDownLeft",
    "Forward": "CornerDownRight",
    "Refresh": "RefreshCw",
    "Reload": "RefreshCw",
    "Sync": "RefreshCw",
    "Notification": "Bell",
    "Alert": "AlertTriangle",
    "Warn": "AlertTriangle",
    "Warning": "AlertTriangle",
    "Approved": "CheckCircle2",
    "Rejected": "XCircle",
    "Tick": "Check",
    "Cross": "X",
    "Close2": "X",
    "Hamburger": "Menu",
    "Drawer": "Menu",
    "Tag2": "Tag",
    "Label": "Tag",
    "Pin2": "Pin",
    "Location": "MapPin",
    "Address": "MapPin",
    "Place": "MapPin",
    "Coin": "Coins",
    "Dollar": "DollarSign",
    "Euro2": "Euro",
    "Pound": "PoundSterling",
}


def apply_icon_fallback_only(tsx: str) -> tuple[str, list[str]]:
    """Rewrite unknown ``Icons.Name`` references to a safe fallback.

    Standalone, side-effect-free icon pass. Resolution order for an
    unknown name:

    1. **Tight typo correction** (``get_close_matches`` cutoff 0.8) — small
       spelling slips like ``Sttings`` → ``Settings``.
    2. **Semantic alias table** — common LLM-hallucinated names whose
       string distance from a valid Lucide name is too high for difflib
       (``Tool`` → ``Wrench``, ``Email`` → ``Mail``, ``Photo`` → ``Image``).
    3. **``Icons.Circle`` fallback** — only when nothing else applies.

    A looser difflib cutoff (~0.6) was considered to catch additional
    near-matches, but rejected: ``CircleZeebraflux`` is closer in raw
    string distance to ``CircleUser`` than to ``Circle``, yet the
    correct rescue is the generic ``Circle`` because the source name is
    clearly a hallucination, not a typo on a specific variant. The
    semantic-alias table absorbs the known LLM-hallucination cases
    without the false-positive risk.

    Used in two places:
      1. Inside :func:`apply_component_urls_images_fixes` as part of the
         normal auto-fix pipeline.
      2. From the post-fix gate's Tier B path in ``artifact_tools.py``,
         to scrub icons from the LLM's *original* code before saving when
         the full fixer pass corrupted JSX. Without this, hallucinated
         names like ``Icons.CircleDollarSign`` ship in the saved file and
         blow up at render time with React error #130 ("element type is
         invalid: got undefined").
    """
    fixes: list[str] = []
    if not _VALID_LUCIDE_ICONS:
        return tsx, fixes
    icon_list = list(_VALID_LUCIDE_ICONS)
    fallback = "Circle" if "Circle" in _VALID_LUCIDE_ICONS else icon_list[0]

    # Filter the alias table once per call to a snapshot of currently-valid
    # Lucide names so an alias pointing at a removed icon doesn't crash.
    aliases = {
        bad: good for bad, good in _ICON_SEMANTIC_ALIASES.items() if good in _VALID_LUCIDE_ICONS
    }

    def _strip_alias_suffix(candidate: str) -> str:
        """``ShieldIcon`` → ``Shield`` when both are valid.

        ``lucide-react`` exports both ``Shield`` and ``ShieldIcon`` as
        aliases of the same component, so the validator's
        ``valid_lucide_icons.json`` lists both. But the SDK's runtime
        ``Icons`` Proxy (``packages/exepad-sdk/src/curated-icons.ts``)
        builds its PascalCase lookup from ``dynamicIconImports`` keys
        only (bare names, no ``Icon`` suffix), so ``Icons.ShieldIcon``
        falls through to ``HelpCircle`` at render time. App
        ``n1aloggh`` post-mortem.
        """
        if candidate.endswith("Icon") and len(candidate) > len("Icon"):
            base = candidate[: -len("Icon")]
            if base in _VALID_LUCIDE_ICONS:
                return base
        return candidate

    def fix(m: re.Match) -> str:
        name = m.group(1)
        # Normalize alias-suffix first so subsequent passes are stable.
        stripped = _strip_alias_suffix(name)
        if stripped != name:
            fixes.append(f"Alias-suffix: Icons.{name} → Icons.{stripped}")
            return f"Icons.{stripped}"
        if name in _VALID_LUCIDE_ICONS:
            return m.group(0)
        close = get_close_matches(name, icon_list, n=1, cutoff=0.8)
        if close:
            # If the close match is itself an alias-suffix form, prefer
            # the bare name so the fixer is idempotent (otherwise the
            # next pass would strip the suffix and log a second fix).
            resolved = _strip_alias_suffix(close[0])
            # Reject a match that collapses a multi-character typo to a
            # single-letter icon (e.g. ``Icons`` fuzzy-matches ``XIcon`` →
            # stripped to ``X``). That is never a real spelling slip and was
            # the seed of the chained ``Icons.X.Pinterest`` crash on app
            # ``mr5czdwj``; fall through to alias/fallback instead.
            if not (len(resolved) == 1 and len(name) > 2):
                fixes.append(f"Typo: Icons.{name} → Icons.{resolved}")
                return f"Icons.{resolved}"
        alias = aliases.get(name)
        if alias is not None:
            fixes.append(f"Alias: Icons.{name} → Icons.{alias}")
            return f"Icons.{alias}"
        fixes.append(f"Unknown icon Icons.{name} → Icons.{fallback} (fallback)")
        return f"Icons.{fallback}"

    # Pre-pass — collapse chained ``Icons.<A>.<B>`` (PascalCase segments) to the
    # leaf icon name. Icon components have no sub-properties, so any chain is a
    # guaranteed React #130 crash; the leaf segment sits in the icon position
    # and is the intended name. ``Icons.Icons.Pinterest`` / ``Icons.X.Pinterest``
    # → ``Icons.Pinterest`` (then resolved to a safe fallback by ``fix`` below).
    # Restricted to PascalCase.PascalCase so the lowercase loop-variable case
    # (``Icons.stat.icon``) is left for ``IconsUnknownRule`` to flag.
    def _collapse_chain(m: re.Match) -> str:
        leaf = m.group(1)
        fixes.append(f"Chained icon access {m.group(0)} → Icons.{leaf}")
        return f"Icons.{leaf}"

    tsx = re.sub(r"Icons\.[A-Z]\w*(?:\.[A-Z]\w*)*\.([A-Z]\w*)", _collapse_chain, tsx)
    tsx = re.sub(r"Icons\.([A-Z]\w*)", fix, tsx)
    return tsx, fixes


def _classify_image_url(url: str, provider_configured: bool = True) -> tuple[str, str] | None:
    """Return ``(domain, kind)`` for ``url`` where ``kind`` is one of
    ``"blocked"`` / ``"unknown"``, or ``None`` if the URL should be kept.

    ``"allowed"`` domains return ``None`` — they're well-known image
    hosts (CloudFront, our R2 bucket, etc.) that the resolver shouldn't
    rewrite. ``"blocked"`` and ``"unknown"`` both rewrite to
    ``__PLACEHOLDER__`` but emit different telemetry messages.

    When ``provider_configured`` is False, NO keyword-search stock provider
    can re-source a stripped URL, so a valid http(s) URL is KEPT verbatim
    (returning ``None``) rather than rewritten to a placeholder that would
    only ever render as a gray box.
    """
    if not url.startswith(("http://", "https://")):
        return None
    parts = url.split("/")
    if len(parts) < 3:
        return None
    domain = parts[2].lower()
    if not domain:
        return None
    if _is_image_domain_allowed(domain):
        return None
    if not provider_configured:
        return None
    if _is_image_domain_blocked(domain):
        return (domain, "blocked")
    return (domain, "unknown")


def _fix_hallucinated_img_urls_ast(
    tsx: str, fixes_applied: list[str], provider_configured: bool = True
) -> str:
    """Walk JSX ``<img>`` and ``<ExepadImage>`` elements; replace blocked/unknown ``src`` URLs.

    Replaces the legacy ``re.sub(r"<img\\b[^>]*?>", ...)`` over raw TSX —
    that regex would in principle match ``<img>`` text inside JSDoc
    comments. Tree-sitter's JSX walker only sees real elements.

    Skips ``src={expression}`` (dynamic) and ``<iframe>`` / ``<video>`` /
    ``<source>`` etc. (different tag names). ``<ExepadImage>`` was added
    2026-05-12: previously its hardcoded external src URLs slipped past
    the fixer, leaving Wikipedia/CDN hot-links in shipped components.
    """
    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)
    edits: list[tuple[int, int, str]] = []
    for el in iter_jsx_opening_elements(tree.root_node):
        if jsx_tag_name(el, buf).lower() not in ("img", "exepadimage"):
            continue
        src_value = jsx_attribute_value_node(el, "src", buf)
        if src_value is None or src_value.type != "string":
            continue
        url = string_literal_value(src_value, buf)
        if url is None:
            continue
        classification = _classify_image_url(url, provider_configured)
        if classification is None:
            continue
        domain, kind = classification
        if kind == "blocked":
            fixes_applied.append(f"Replaced hallucinated URL from {domain} with __PLACEHOLDER__")
        else:
            fixes_applied.append(
                f"Replaced unknown external URL from {domain} with __PLACEHOLDER__"
            )
        # Splice the URL inner text only — preserves the original
        # quote characters so single/double quotes both round-trip.
        edits.append((src_value.start_byte + 1, src_value.end_byte - 1, "__PLACEHOLDER__"))

    if not edits:
        return tsx
    out = buf
    for start, end, replacement in sorted(edits, key=lambda e: -e[0]):
        out = out[:start] + replacement.encode("utf-8") + out[end:]
    return out.decode("utf-8")


def _fix_hallucinated_array_image_urls_ast(
    tsx: str, fixes_applied: list[str], provider_configured: bool = True
) -> str:
    """Walk JS array-literal pairs with image-shaped keys, replace URLs.

    Catches ``image: "https://x.com/..."`` patterns in data arrays.
    AST migration of the legacy
    ``re.sub(r"((?:image|src|...)\\s*:\\s*[\"']) ...")`` over raw TSX.
    """
    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)
    edits: list[tuple[int, int, str]] = []
    fix_messages: list[str] = []
    for pair in find_by_type(tree.root_node, "pair"):
        key = pair.child_by_field_name("key")
        if key is None or key.type not in ("property_identifier", "identifier"):
            continue
        key_name = buf[key.start_byte : key.end_byte].decode("utf-8")
        if key_name.lower() not in _IMAGE_KEY_NAMES:
            continue
        value = pair.child_by_field_name("value")
        if value is None or value.type != "string":
            continue
        url = string_literal_value(value, buf)
        if url is None:
            continue
        classification = _classify_image_url(url, provider_configured)
        if classification is None:
            continue
        domain, kind = classification
        if kind == "blocked":
            fix_messages.append(
                f"Replaced hallucinated array image URL from {domain} with __PLACEHOLDER__"
            )
        else:
            fix_messages.append(
                f"Replaced unknown array image URL from {domain} with __PLACEHOLDER__"
            )
        edits.append((value.start_byte + 1, value.end_byte - 1, "__PLACEHOLDER__"))

    if not edits:
        return tsx
    out = buf
    for start, end, replacement in sorted(edits, key=lambda e: -e[0]):
        out = out[:start] + replacement.encode("utf-8") + out[end:]
    fixes_applied.extend(fix_messages)
    return out.decode("utf-8")


def _strip_unresolvable_css_placeholders(tsx: str, fixes_applied: list[str]) -> str:
    """Remove ``__PLACEHOLDER__`` left in CSS ``url()`` contexts.

    Unlike ``<img src="__PLACEHOLDER__">`` / ``image: "__PLACEHOLDER__"`` (which
    the image resolver fills in), CSS ``url('__PLACEHOLDER__')`` has NO
    downstream resolver. A Tailwind arbitrary background class left as
    ``bg-[url('__PLACEHOLDER__')]`` ships into compiled.css and the browser
    GETs ``/__PLACEHOLDER__`` (SPA-fallback 200, junk image) — app ``mr5czdwj``
    CateringContent. Drop the whole decorative arbitrary-value class, then
    neutralize any remaining inline-style ``url('__PLACEHOLDER__')`` to ``none``.
    ``__PLACEHOLDER__`` reaches CSS context only via our own substitution
    upstream, so these rewrites can't touch ``<img>`` / data arrays.
    """

    def _drop_placeholder_bg_class(m: re.Match) -> str:
        fixes_applied.append(
            "Dropped decorative bg-[url()] class with unresolvable __PLACEHOLDER__"
        )
        return ""

    tsx = re.sub(
        r"""\s?[\w-]*\[(?:[a-z-]+:)?url\(['"]?__PLACEHOLDER__['"]?\)\]""",
        _drop_placeholder_bg_class,
        tsx,
    )
    if "url('__PLACEHOLDER__')" in tsx or 'url("__PLACEHOLDER__")' in tsx:
        tsx = re.sub(r"""url\(['"]?__PLACEHOLDER__['"]?\)""", "none", tsx)
        fixes_applied.append(
            "Neutralized inline-style url('__PLACEHOLDER__') → none (no CSS resolver)"
        )
    return tsx


def apply_component_urls_images_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    # Icon name fixes — delegated to the standalone helper so the same
    # rewrite can run from the Tier B fallback path without depending on
    # the full FixContext.
    tsx, icon_fixes = apply_icon_fallback_only(tsx)
    fixes_applied.extend(icon_fixes)

    # When no keyword-search stock provider is configured, KEEP valid http(s)
    # image URLs instead of stripping them to __PLACEHOLDER__ — nothing could
    # re-source the placeholder, so the strip would only ever yield a gray box.
    pc = ctx.stock_provider_configured

    # Hallucinated / unknown image URL replacement — rewrite blocked and
    # unrecognized domains to __PLACEHOLDER__ so the downstream image resolver
    # can fetch properly licensed stock images.
    # Scoped to <img> tags only so <iframe>, <video>, <source> etc. keep their URLs.
    tsx = _fix_hallucinated_img_urls_ast(tsx, fixes_applied, pc)

    # Hallucinated / unknown image URLs in JS data array properties.
    # Catches patterns like:  image: "https://img.b2bpic.net/..."
    # and replaces them with: image: "__PLACEHOLDER__"
    # so the downstream image resolver can fetch unique stock images per item.
    tsx = _fix_hallucinated_array_image_urls_ast(tsx, fixes_applied, pc)

    # Static src inside .map() auto-fix: after hallucinated URL replacement,
    # <img src="__PLACEHOLDER__"> inside .map() blocks should become src={item.image}
    # (where "item" is the map callback parameter).  Also ensures each data-array
    # object in the mapped source gains an `image: "__PLACEHOLDER__"` property so
    # the downstream image resolver can populate real URLs per row.
    #
    # Scope detection uses paren-balance from the opening ``(`` of ``.map(``
    # to its matching ``)`` — NOT a fixed character window. Rewriting <img>
    # tags outside the map callback produces runtime ReferenceErrors because
    # the map param is not in scope there.
    tsx = _rewrite_static_img_src_in_map_callbacks(tsx, fixes_applied, pc)

    # Hallucinated / unknown URLs in CSS url() patterns (style attributes)
    def _fix_hallucinated_style_url(m):
        full = m.group(0)
        try:
            domain = m.group(1).lower()
        except (IndexError, AttributeError):
            return full
        if _is_image_domain_allowed(domain):
            return full
        if not pc:
            # No stock provider can re-source it (and there is no CSS
            # resolver anyway) — keep the working background URL verbatim
            # rather than rewriting it to an unresolvable __PLACEHOLDER__.
            return full
        if _is_image_domain_blocked(domain):
            fixes_applied.append(
                f"Replaced hallucinated style URL from {domain} with __PLACEHOLDER__"
            )
            return "url('__PLACEHOLDER__')"
        fixes_applied.append(f"Replaced unknown style URL from {domain} with __PLACEHOLDER__")
        return "url('__PLACEHOLDER__')"

    tsx = re.sub(
        r"""url\s*\(\s*['"]?https?://([^/"')]+)[^"')]*['"]?\s*\)""",
        _fix_hallucinated_style_url,
        tsx,
    )

    tsx = _strip_unresolvable_css_placeholders(tsx, fixes_applied)

    # Baked-URL leak for design-import assets: the LLM (or a buggy resolver)
    # may emit ``src="/a/<anything>/repo/assets/<rel>"`` — usually with the
    # agent's internal ``app_uuid`` and the pre-optimization extension,
    # which 404s because the deploy pipeline serves under ``public_id``
    # with WebP-converted extensions. Rewrite to the ``__ASSET_IMG:`` deploy
    # placeholder that the backend resolves to the correct final URL.
    def _fix_baked_repo_asset_src(m):
        rel = m.group(1)  # e.g. "assets/imports/abc.png" or "assets/images/foo.jpg"
        fixes_applied.append(
            f"Rewrote baked /a/.../repo/{rel} URL to __ASSET_IMG:{rel}__ placeholder"
        )
        return f'src="__ASSET_IMG:{rel}__"'

    tsx = re.sub(
        r"""src=["']/a/[^"'/]+/repo/(assets/[^"']+?)["']""",
        _fix_baked_repo_asset_src,
        tsx,
    )

    # Strip the now-stale ``vendor="design_import"`` attribute that the
    # old resolver injected alongside the baked URL. The deploy rewriter
    # never emits it; keeping it causes regenerated-vs-rewritten drift.
    # Only strip when the same tag also carries an ``__ASSET_IMG:``
    # placeholder — avoids false positives on hand-authored tags.
    def _strip_vendor_on_placeholder_tag(m: re.Match) -> str:
        tag = m.group(0)
        if "__ASSET_IMG:" not in tag:
            return tag
        return re.sub(r'\s+vendor="design_import"', "", tag)

    tsx = re.sub(
        r"<ExepadImage\b[^>]*?/>",
        _strip_vendor_on_placeholder_tag,
        tsx,
    )

    # Bare-slug navigation leak: ``href: "products"`` (no leading ``/``) or
    # ``navigate("products")`` falls through the SDK's basePath prepend and
    # the browser treats it as relative to the current URL. On sub-pages
    # this produces ``/<app>/<current>/<target>`` → 404. Leading ``/`` is
    # required for the SDK to know it's an app-internal absolute path.
    # Allow-list: ``/`` itself, fragment links ``#...``, and tel:/mailto:.
    # Both single- and double-quoted string literals are covered — LLMs
    # mix quote styles freely and the SDK treats both identically.
    _SKIPPED_PREFIXES = ("/", "#", ".")

    # Imported HTML uses ``<a href="shop.html">`` style links. The runtime's
    # routes don't carry the ``.html`` suffix (they're declared as ``/shop``,
    # ``/story``, etc.), so a naive ``/shop.html`` rewrite produces a 404.
    # Strip the suffix when prepending so the fixed link resolves.
    _STRIPPABLE_HTML_SUFFIX = ".html"

    def _normalize_slug(raw: str) -> str:
        """Trim whitespace + strip a trailing ``.html`` suffix.

        Defensive against LLM-emitted slugs like ``" /"`` (leading space)
        and against imported-HTML hrefs like ``"shop.html"`` whose ``.html``
        suffix isn't present in the runtime's actual routes.
        """
        s = raw.strip()
        if s.lower().endswith(_STRIPPABLE_HTML_SUFFIX) and len(s) > len(_STRIPPABLE_HTML_SUFFIX):
            s = s[: -len(_STRIPPABLE_HTML_SUFFIX)]
        return s

    def _should_prepend_slash(slug: str) -> bool:
        if not slug or slug == ".":
            return False
        if slug.startswith(_SKIPPED_PREFIXES):
            return False
        # ``http:``, ``https:``, ``mailto:``, ``tel:`` — any ``scheme:`` form.
        if ":" in slug:
            return False
        return True

    def _fix_bare_href_in_navlinks(m: re.Match) -> str:
        prefix, quote, raw = m.group(1), m.group(2), m.group(3)
        slug = _normalize_slug(raw)
        if not _should_prepend_slash(slug):
            return m.group(0)
        fixes_applied.append(f"Prepended leading '/' to bare-slug nav href: '{raw}' → '/{slug}'")
        return f"{prefix}{quote}/{slug}{quote}"

    # href: "<slug>" / href: '<slug>' inside a literal array (both quote styles)
    tsx = re.sub(
        r"""(href\s*:\s*)(["'])([^"'/#][^"']*)\2""",
        _fix_bare_href_in_navlinks,
        tsx,
    )

    # href="<slug>" / href='<slug>' as a JSX attribute. Scoped via the
    # attribute-value pattern so the fix only targets element attributes,
    # not object-property ``href:`` forms already covered above.
    def _fix_bare_href_attr(m: re.Match) -> str:
        prefix, quote, raw = m.group(1), m.group(2), m.group(3)
        slug = _normalize_slug(raw)
        if not _should_prepend_slash(slug):
            return m.group(0)
        fixes_applied.append(f"Prepended leading '/' to bare-slug href attr: '{raw}' → '/{slug}'")
        return f"{prefix}{quote}/{slug}{quote}"

    tsx = re.sub(
        r"""(\bhref\s*=\s*)(["'])([^"'/#{][^"']*)\2""",
        _fix_bare_href_attr,
        tsx,
    )

    def _fix_bare_navigate_arg(m: re.Match) -> str:
        prefix, quote, raw = m.group(1), m.group(2), m.group(3)
        slug = _normalize_slug(raw)
        if not _should_prepend_slash(slug):
            return m.group(0)
        fixes_applied.append(f"Prepended leading '/' to navigate() arg: '{raw}' → '/{slug}'")
        return f"{prefix}{quote}/{slug}{quote})"

    # navigate("<slug>") / navigate('<slug>') — both quote styles. Also
    # matches ``handleNavigate("<slug>")`` so local helper wrappers behave.
    tsx = re.sub(
        r"""((?:handle)?[Nn]avigate\s*\(\s*)(["'])([^"'/#][^"']*)\2\s*\)""",
        _fix_bare_navigate_arg,
        tsx,
    )

    # <Link to="<slug>"> / <Link to='<slug>'> — same rule. Scoped to tags
    # beginning with ``<Link`` so we don't touch other JSX attributes
    # called ``to`` (e.g. SVG ``animate``).
    def _fix_bare_link_tag(m: re.Match) -> str:
        tag = m.group(0)

        def _inner(tm: re.Match) -> str:
            prefix, quote, raw = tm.group(1), tm.group(2), tm.group(3)
            slug = _normalize_slug(raw)
            if not _should_prepend_slash(slug):
                return tm.group(0)
            fixes_applied.append(f"Prepended leading '/' to <Link to> prop: '{raw}' → '/{slug}'")
            return f"{prefix}{quote}/{slug}{quote}"

        return re.sub(
            r"""(\bto\s*=\s*)(["'])([^"'/#][^"']*)\2""",
            _inner,
            tag,
        )

    tsx = re.sub(r"<Link\b[^>]*>", _fix_bare_link_tag, tsx)

    # Convert raw <img> with placeholder/empty src to <ExepadImage> so the
    # downstream resolver can use the structured props path.
    tsx = _fix_raw_img_to_exepad_image(tsx, fixes_applied)

    # Normalize ExepadImage prop syntax and inject missing defaults.
    tsx = _fix_exepad_image_props(tsx, fixes_applied)

    # Placeholder div detection: the LLM sometimes generates gray-box divs with
    # descriptive text instead of implementing the visual in CSS/SVG/canvas code.
    # These are NOT auto-fixed — the fixer agent must regenerate with real code.
    # (check_placeholder_divs() raises an error that triggers regeneration.)

    return tsx
