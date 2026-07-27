"""Stage 2: Semantic validation — residual regex checks + AST rule dispatch.

Most semantic validation lives in the AST rule engine
(``tsx_ast.rules``); this module hosts the residual regex checks for
patterns that haven't moved to AST yet:

- ``check_enum_coverage`` — switch/map branches against declared enum values
- ``check_broken_optional_chain`` — chains that start but don't propagate
- ``check_low_opacity_bg`` — near-invisible background tints
- ``check_hallucinated_image_urls`` / ``check_hallucinated_style_urls``
  / ``check_duplicate_image_urls`` — LLM image hallucinations
- ``check_placeholder_divs`` — fake-data placeholder anti-pattern
- ``check_exepad_image_props`` / ``_dimensions`` / ``_duplicate_keywords``
- ``check_status_style_map_case`` — title-case status keys vs lowercase D1

``run_semantic_checks`` is the public combined entry: it dispatches the
component AST rule set, then runs the residual regex checks above, and
merges everything into a single ``SemanticResult``.
"""

import os
import re
from dataclasses import dataclass, field

import structlog

logger = structlog.get_logger(__name__)

from .finding import Finding
from .tsx_ast import (
    AstContext,
    collect_static_classnames,
    parse_tsx,
    run_rules,
    source_bytes,
)
from .tsx_ast.rules.default_set import component_rules
from .tsx_ast.catalog import (
    ALLOWED_IMAGE_DOMAINS as _CATALOG_ALLOWED_IMAGE_DOMAINS,
    ALLOWED_IMPORT_SOURCES as _CATALOG_ALLOWED_IMPORT_SOURCES,
    EXEPAD_IMAGE_FALLBACK_KEYWORDS as _CATALOG_EXEPAD_IMAGE_FALLBACK_KEYWORDS,
    HALLUCINATED_IMAGE_DOMAINS as _CATALOG_HALLUCINATED_IMAGE_DOMAINS,
    SDK_HOOK_NULLABLE_FIELDS as _CATALOG_SDK_HOOK_NULLABLE_FIELDS,
    STATUS_WORDS_LOWER as _CATALOG_STATUS_WORDS_LOWER,
    STATUS_WORDS_TITLE as _CATALOG_STATUS_WORDS_TITLE,
    TRIGGER_ASCHILD_COMPONENTS as _CATALOG_TRIGGER_ASCHILD_COMPONENTS,
    load_lucide_icons as _catalog_load_lucide_icons,
    load_sdk_exports as _catalog_load_sdk_exports,
)

# ---------------------------------------------------------------------------
# Constants — re-exported from ``tsx_ast.catalog`` so this module stays the
# only public surface regex check functions read from, while the catalog
# stays the single source of truth.
# ---------------------------------------------------------------------------

ALLOWED_IMPORT_SOURCES = _CATALOG_ALLOWED_IMPORT_SOURCES
EXEPAD_IMAGE_FALLBACK_KEYWORDS = _CATALOG_EXEPAD_IMAGE_FALLBACK_KEYWORDS

_VALID_LUCIDE_ICONS: frozenset[str] = _catalog_load_lucide_icons()
_SDK_EXPORTS: frozenset[str] = _catalog_load_sdk_exports()

ALWAYS_FORBIDDEN = [
    (r"\beval\s*\(", "eval() is forbidden"),
    (r"\bnew\s+Function\s*\(", "new Function() is forbidden"),
    (r"\bXMLHttpRequest\b", "XMLHttpRequest forbidden — use SDK hooks"),
    (r"\blocalStorage\b", "localStorage is forbidden"),
    (r"\bsessionStorage\b", "sessionStorage is forbidden"),
    (r"\bconsole\.log\s*\(", "console.log() is forbidden — remove debug logging"),
]

# ---------------------------------------------------------------------------
# SDK import helpers
# ---------------------------------------------------------------------------


_SDK_IMPORT_RE = re.compile(r"import\s+\{([^}]+)\}\s+from\s+['\"]@exepad/sdk['\"]")


def _add_sdk_import(tsx: str, name: str) -> str:
    """Add ``name`` to the ``@exepad/sdk`` import list, rebuilding the statement cleanly.

    Naive text append (``old + ", " + name``) produces malformed imports when the
    existing list spans multiple lines or has trailing whitespace/commas (e.g.
    ``AlertDialogTitle,\\n  , DialogDescription}``). This helper parses the current
    import names, deduplicates, sorts, and re-emits the whole statement — the same
    safe pattern used for the bulk missing-imports pass.

    Returns the tsx unchanged if there is no ``@exepad/sdk`` import or the name
    is already imported.
    """
    match = _SDK_IMPORT_RE.search(tsx)
    if not match:
        return tsx
    current = {tok.strip() for tok in match.group(1).split(",") if tok.strip()}
    if name in current:
        return tsx
    current.add(name)
    new_stmt = f"import {{ {', '.join(sorted(current))} }} from '@exepad/sdk'"
    return tsx[: match.start()] + new_stmt + tsx[match.end() :]


# Radix ``*Trigger`` components that use Slot internally when ``asChild`` is
# set. When the wrapped Button has mixed element+text children, the bundled
# Slot has been observed to throw ``React.Children.only`` at runtime. See
# ``_wrap_mixed_trigger_button_children`` below.
_ASCHILD_TRIGGER_TAGS = _CATALOG_TRIGGER_ASCHILD_COMPONENTS


# NOTE on ``(?:[^>{]|\{[^{}]*\})*``: a JSX open tag's ``>`` must be found WITHOUT
# tripping on a ``>`` that lives inside a ``{...}`` prop expression — most commonly
# the ``=>`` of an arrow handler (``onClick={() => fn()}``). A plain ``[^>]*`` stops
# at that inner ``>`` and splits the tag mid-prop, which used to corrupt the JSX
# (and leak prop text into the "button body", triggering a false mixed-child wrap on
# icon-ONLY buttons). Consuming single-level ``{...}`` atomically finds the real tag
# close. A prop with NESTED braces (``onClick={() => { a(); }}``) simply fails to
# match and the button is left untouched — a safe skip, never a corruption.
# ``(?:[^>{]|\{[^{}]*\})*`` finds a JSX open tag's ``>`` WITHOUT tripping on a ``>``
# inside a ``{...}`` prop expression — most commonly the ``=>`` of an arrow handler
# (``onClick={() => fn()}``). A trigger with such a prop before ``asChild`` simply
# fails to match (safe skip); only the Button open tag needs the brace-aware form.
_JSX_OPEN_TAG_INNER = r"(?:[^>{]|\{[^{}]*\})*"
_TRIGGER_ASCHILD_BUTTON_RE = re.compile(
    r"""(
        <(?P<trigger>(?:%s))\b[^>]*\basChild\b[^>]*>            # opening trigger tag with asChild
        \s*
        (?P<button_open><Button\b%s>)                           # opening Button (brace-aware)
        (?P<button_body>.*?)                                    # button inner content (non-greedy)
        </Button>
        \s*
        </(?P=trigger)>                                         # closing trigger tag
    )""" % ("|".join(_ASCHILD_TRIGGER_TAGS), _JSX_OPEN_TAG_INNER),
    re.DOTALL | re.VERBOSE,
)


def _wrap_mixed_trigger_button_children(tsx: str) -> tuple[str, list[str]]:
    """Wrap mixed children of ``<Button>`` under ``*Trigger asChild`` in a span.

    Pattern: ``<DialogTrigger asChild><Button>...</Button></DialogTrigger>``
    where the Button contains BOTH a JSX element (e.g. an icon) AND visible
    text — either a string literal or a ``{}`` expression. Radix's Slot
    wraps Button under ``asChild`` and has been observed to crash at render
    time with ``React.Children.only expected to receive a single React
    element child`` on icon+text buttons. Wrapping the inner content in a
    single ``<span class="inline-flex items-center gap-2">`` gives the
    Button exactly one element child and eliminates the failure mode.

    Returns ``(tsx, fixes_applied)``. Idempotent — content already wrapped
    in a single span is left untouched.
    """
    fixes: list[str] = []

    def _fix(match: re.Match) -> str:
        button_body = match.group("button_body")
        if not button_body or not button_body.strip():
            return match.group(0)
        stripped = button_body.strip()
        # Already single <span> wrapper — nothing to do.
        if stripped.startswith("<span") and stripped.endswith("</span>"):
            # Check there is only one top-level span. A body that opens with
            # <span and ends with </span> but has more siblings after the
            # first close would still need wrapping; this check is best-effort.
            if stripped.count("<span") == 1 and stripped.count("</span>") == 1:
                return match.group(0)

        # Does the body contain at least one JSX element?
        has_element = bool(re.search(r"<[A-Za-z]", stripped))
        # Does it also contain visible text outside tags or a {expression}?
        # We strip all balanced tag pairs (crude: remove anything inside < >)
        # and check what's left — if it contains any non-whitespace, there's
        # mixed content.
        text_outside = re.sub(r"<[^>]+>", "", stripped)
        has_text = bool(text_outside.strip())

        if not (has_element and has_text):
            return match.group(0)

        trigger = match.group("trigger")
        button_open = match.group("button_open")
        # Preserve original indentation by not reformatting the inner body —
        # just wrap it in a span. Two leading newlines keep readable output.
        wrapped = (
            f"{button_open}\n"
            f'            <span className="inline-flex items-center gap-2">'
            f"{button_body}"
            f"</span>\n          </Button>"
        )
        fixes.append(f"Wrapped mixed icon+text children in <span> under <{trigger} asChild>")
        return match.group(0).replace(f"{button_open}{button_body}</Button>", wrapped, 1)

    tsx = _TRIGGER_ASCHILD_BUTTON_RE.sub(_fix, tsx)
    return tsx, fixes


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class SemanticResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return len(self.errors) == 0


# ---------------------------------------------------------------------------
# Check functions
# ---------------------------------------------------------------------------


def _collect_enum_columns(models: list[dict]) -> list[tuple[str, str, list[str]]]:
    """Extract ``(model, column, enum_values)`` triples from a models list.

    Accepts columns in both camelCase (``enumValues``, ``isNullable``) and
    snake_case (``enum_values``) so this check can run against any stage
    of the agent pipeline — ``ModelPlan.model_dump()``, the persisted
    backend config, or the live ``backend_surface`` JSON. Skips columns
    that lack an ``enum_values`` list or whose list is empty.
    """
    enum_cols: list[tuple[str, str, list[str]]] = []
    for model in models or []:
        if not isinstance(model, dict):
            continue
        model_name = model.get("name") or ""
        if not model_name:
            continue
        for col in model.get("columns", []) or []:
            if not isinstance(col, dict):
                continue
            col_name = col.get("name")
            if not col_name:
                continue
            raw = col.get("enum_values") or col.get("enumValues")
            if not isinstance(raw, list) or not raw:
                continue
            values = [str(v) for v in raw if v is not None]
            if values:
                enum_cols.append((model_name, col_name, values))
    return enum_cols


def _quote(value: str) -> str:
    """Return ``value`` wrapped in double quotes for error messages."""
    return f'"{value}"'


def check_enum_coverage(tsx: str, models: list[dict]) -> list[str]:
    """Warn when component code misses declared ``enum_values`` for a column.

    Finds every column whose schema declares a closed vocabulary and looks
    for rendering code that branches on that column's value — either as a
    ``switch (row.col) { case "x": ... }`` statement or as an object
    literal used as a style/label map keyed by string literals. If any
    declared value is absent from the branches, emit a warning listing
    the missing strings.

    This is the guardrail for the bug class where a generated component
    hardcodes a stale status vocabulary and every non-matching row renders
    with the ``default`` branch's label. The check is **warning-only** —
    intentional collapsing (e.g. grouping "in review" and "pending" under
    one badge) is a legitimate pattern. The warning ships with the
    artifact and surfaces in the SSE response; the user iterates via the
    editor flow if needed.

    Accepts both camelCase (``enumValues``) and snake_case (``enum_values``)
    so the check works at every pipeline stage.
    """
    enum_cols = _collect_enum_columns(models)
    if not enum_cols:
        return []

    warnings: list[str] = []

    for model_name, col_name, allowed in enum_cols:
        # Collect string literals the component branches on for this column.
        # We look for two common shapes:
        #   1) switch-cases that scrutinize `<something>.{col}` (optionally
        #      chained through ?. / toLowerCase/toUpperCase) and enumerate
        #      `case "x":` branches.
        #   2) Object literals used as style/label maps whose keys are
        #      string literals — `const STYLES = { "x": ..., "y": ... }`.
        #
        # Rather than parsing the AST we use conservative regexes: a single
        # switch/map can cover multiple columns in a single component, so
        # we gather every literal that appears as a `case` target or as an
        # object-literal key, then check whether all declared enum values
        # are represented somewhere. False positives on overlapping
        # vocabularies are still "missing values for column X" warnings,
        # which is acceptable at warning severity.
        seen_literals: set[str] = set()

        # Shape 1: switch cases. We don't bind the switch to a specific
        # column — any `case "literal":` that appears near a reference to
        # the column name (within ~500 chars) counts as coverage. This
        # gracefully handles helpers like `getStatusBadge(request.status)`
        # whose switch body is remote from the call site but is scoped to
        # one column.
        col_ref_pattern = re.compile(rf"\b{re.escape(col_name)}\b", flags=re.IGNORECASE)
        # Find all `case "X":` locations. Each is a (start, literal).
        for match in re.finditer(r"case\s+['\"]([^'\"]+)['\"]\s*:", tsx):
            case_start = match.start()
            literal = match.group(1)
            # Accept the case only if the column name appears within a
            # 400-char window — that's wide enough to cover a normal
            # helper body and narrow enough to avoid crosstalk between
            # unrelated switches.
            window = tsx[max(0, case_start - 400) : case_start + 400]
            if col_ref_pattern.search(window):
                seen_literals.add(literal)

        # Shape 2: object literal keys used as a style/label map. Same
        # windowing trick — accept if the column name is mentioned nearby.
        # This catches `const STATUS_STYLES = { "draft": "...", ... }`
        # patterns and similar.
        for match in re.finditer(r"['\"]([^'\"\n]+)['\"]\s*:", tsx):
            literal = match.group(1)
            window = tsx[max(0, match.start() - 400) : match.start() + 400]
            if col_ref_pattern.search(window):
                seen_literals.add(literal)

        if not seen_literals:
            # No branching at all — component doesn't visibly render this
            # column as a categorical value. That's fine (it may not show
            # it at all) — nothing to warn about.
            continue

        missing = [v for v in allowed if v not in seen_literals]
        if missing:
            warnings.append(
                "Column {col} on model {model} declares "
                "enum_values={values}; component rendering omits "
                "{missing}. Cover every declared value explicitly — the "
                "default branch must be a safe fallback, not a business "
                "label.".format(
                    col=_quote(col_name),
                    model=_quote(model_name),
                    values=allowed,
                    missing=[_quote(v) for v in missing],
                )
            )
    return warnings


# SDK hooks that return objects with nullable fields. Re-exported for the
# null-safety auto-fixer (component_null_safety.py).
_SDK_HOOK_NULLABLE_FIELDS = _CATALOG_SDK_HOOK_NULLABLE_FIELDS


def check_broken_optional_chain(tsx: str) -> list[str]:
    """Detect optional chains that start but don't propagate through method calls.

    Pattern: ``obj?.[index].method()`` — the ``?.`` handles the case where
    ``obj`` is nullish, but if it evaluates to ``undefined``, then
    ``.method()`` crashes because there's no ``?.`` before it.

    Fix: ``obj?.[index]?.method()``
    """
    warnings: list[str] = []

    # ?.[index].identifier( — missing ?. before .identifier
    pattern = re.compile(r"\?\.\[[^\]]+\]\.(\w+)\s*\(")
    for m in pattern.finditer(tsx):
        # Check it's not already ?.[index]?.method(
        before_method = tsx[m.start() : m.start() + len(m.group(0))]
        if "?." not in before_method.split("].", 1)[-1]:
            method_name = m.group(1)
            warnings.append(
                f"Broken optional chain: ?.[…].{method_name}() — "
                f"add ?. before .{method_name}() to continue null guard"
            )

    return warnings


def check_low_opacity_bg(tsx: str) -> list[str]:
    """Warn if background opacity modifiers are below /30.

    Very low background tints (bg-*/5, bg-*/10, bg-*/20) are effectively
    invisible and provide no meaningful visual distinction.

    Scoped to JSX className text only — SVG ``fill-opacity``,
    ``bg-foo/N`` mentions in toast strings / JSDoc, and code prose all
    pass through untouched.
    """
    warnings = []
    classname_corpus = " ".join(collect_static_classnames(tsx))
    if not classname_corpus:
        return warnings
    for match in re.finditer(r"\bbg-[\w-]+/(\d+)\b", classname_corpus):
        opacity = int(match.group(1))
        if opacity < 30:
            warnings.append(
                f"Near-invisible background: {match.group(0)} — "
                f"background opacity /{opacity} is effectively invisible. "
                f"Use minimum /30 for tinted backgrounds"
            )
    return warnings


# Light bg classes that override a dark ancestor — used by the measured
# color-contrast check (non-M3 path) further below.
_LIGHT_BG_RE = re.compile(
    r"bg-(?:surface|white|background|surface-variant|surface-container"
    r"|surface-container-low|surface-container-high"
    r"|surface-container-highest|surface-container-lowest"
    r"|primary-container|secondary-container|error-container)\b"
)


def check_hallucinated_style_urls(tsx: str) -> list[str]:
    """Flag hardcoded image URLs in CSS url() patterns (style attributes)."""
    warnings = []
    for match in re.finditer(r"""url\s*\(\s*['"]?https?://([^/"')]+)""", tsx):
        domain = match.group(1).lower()
        if _is_image_domain_blocked(domain):
            warnings.append(f"Hallucinated URL in style from {domain} — will be replaced")
        elif not _is_image_domain_allowed(domain):
            warnings.append(f"Unknown URL in style from {domain} — will be replaced")
    return warnings


_HALLUCINATED_IMAGE_DOMAINS = _CATALOG_HALLUCINATED_IMAGE_DOMAINS
_ALLOWED_IMAGE_DOMAINS = _CATALOG_ALLOWED_IMAGE_DOMAINS


def _is_image_domain_allowed(domain: str) -> bool:
    """Check if a domain is on the static allowlist of trusted image sources.

    Outside production (dev / self-host) local hosts — ``localhost``,
    ``127.0.0.1``, and any ``*.local`` host — are also allowed so that
    self-hosted image URLs aren't rewritten to ``__PLACEHOLDER__``
    (silent image loss). Production stays strict (extend via the
    ``ALLOWED_IMAGE_DOMAINS`` env var instead)."""
    if os.getenv("ENVIRONMENT", "development") != "production":
        if domain == "localhost" or domain == "127.0.0.1" or domain.endswith(".local"):
            return True
    for allowed in _ALLOWED_IMAGE_DOMAINS:
        if domain == allowed or domain.endswith("." + allowed):
            return True
    return False


def _is_image_domain_blocked(domain: str) -> bool:
    """Check if a domain is on the hallucinated/blocked list."""
    for bad_domain in _HALLUCINATED_IMAGE_DOMAINS:
        if domain == bad_domain or domain.endswith("." + bad_domain):
            return True
    return False


def check_hallucinated_image_urls(tsx: str, stock_provider_configured: bool = True) -> list[str]:
    """Flag hardcoded image URLs from unknown or blocked domains.

    Scans both ``<img>`` elements and ``<ExepadImage>`` elements — the
    image resolver is supposed to populate ``<ExepadImage src=>`` with a
    self-hosted ``__ASSET_IMG:…__`` placeholder, so any raw CDN URL there
    indicates either a resolver fallback (GCS upload failed) or an LLM
    hallucination that bypassed the resolver. Either way the URL is
    fragile and shouldn't ship.

    ``<iframe>``, ``<video>``, ``<source>`` etc. are skipped so that
    legitimate embed URLs (e.g. OpenStreetMap) are not flagged.

    ``stock_provider_configured`` here is the strip-vs-keep decision
    (``image_generation_utils.should_strip_llm_image_urls()``): True when a
    keyed stock provider is configured OR the operator disabled LLM-suggested
    image URLs. When False the URLs are deliberately KEPT (nothing re-sources
    them), so flagging them as errors would wrongly block the save — return no
    findings.
    """
    if not stock_provider_configured:
        return []
    warnings = []
    image_tag_re = re.compile(r"<(?:img|ExepadImage)\b[^>]*?/?>", re.IGNORECASE | re.DOTALL)
    for img_match in image_tag_re.finditer(tsx):
        tag = img_match.group(0)
        for match in re.finditer(r'src=["\']https?://([^/"\']+)', tag):
            domain = match.group(1).lower()
            if _is_image_domain_blocked(domain):
                warnings.append(
                    f"Hallucinated image URL from {domain} — will be replaced with stock image"
                )
            elif not _is_image_domain_allowed(domain):
                warnings.append(
                    f"Unknown image domain {domain} — will be replaced with stock image"
                )
    return warnings


def check_duplicate_image_urls(tsx: str) -> list[str]:
    """Warn if multiple <img> tags or array image properties share the same URL."""
    warnings = []
    # Check 1: literal <img> tag duplicates
    urls = re.findall(r'<img\b[^>]*?src=["\']([^"\']+)["\']', tsx, re.IGNORECASE)
    non_placeholder = [
        u for u in urls if u and u != "__PLACEHOLDER__" and not u.startswith("data:")
    ]
    if len(non_placeholder) >= 2 and len(set(non_placeholder)) == 1:
        warnings.append(
            f"All {len(non_placeholder)} images use the same URL — "
            f"each image should have a unique src"
        )

    # Check 2: duplicate URLs in JS array image properties
    array_img_urls = re.findall(
        r"(?:image|src|photo|avatar|thumbnail|cover|picture|img)"
        r"""\s*:\s*["'](https?://[^"']+)["']""",
        tsx,
        re.IGNORECASE,
    )
    arr_non_placeholder = [u for u in array_img_urls if u and u != "__PLACEHOLDER__"]
    if len(arr_non_placeholder) >= 2 and len(set(arr_non_placeholder)) == 1:
        warnings.append(
            f"All {len(arr_non_placeholder)} array image properties use the same URL — "
            f"each item should have a unique image"
        )

    return warnings


# Pattern to detect LLM-generated placeholder divs that should have been <img> tags.
# Matches: <div className="...bg-gray-*...flex items-center justify-center...">
#          <span className="...text-gray-*...">descriptive text</span></div>
_PLACEHOLDER_DIV_PATTERN = re.compile(
    r'<div\s+className="[^"]*(?:bg-gray-\d+|bg-neutral-\d+|bg-slate-\d+)[^"]*'
    r'(?:flex\s+items-center\s+justify-center|items-center\s+justify-center)[^"]*">'
    r'\s*<span\s+className="[^"]*(?:text-gray-\d+|text-neutral-\d+|text-slate-\d+)[^"]*">'
    r"([^<]+)</span>\s*</div>",
    re.DOTALL,
)

# Map-related keywords — placeholder divs with these should become OpenStreetMap
# iframes, not stock photos. Uses word boundaries to avoid false positives on
# "roadmap", "bitmap", etc.
_MAP_KEYWORD_RE = re.compile(r"\bmap\b|\bmaps\b|\bsatellite\b", re.IGNORECASE)


def check_placeholder_divs(tsx: str) -> list[str]:
    """Flag placeholder divs that should be implemented as real UI code.

    Returns error messages (not warnings) so the fixer agent regenerates
    placeholder divs with actual CSS/SVG/canvas implementations.
    """
    matches = _PLACEHOLDER_DIV_PATTERN.findall(tsx)
    if matches:
        descs = [m.strip()[:60] for m in matches]
        return [
            f"Found {len(matches)} placeholder div(s) with descriptive text instead of "
            f"implemented UI: {descs}. Replace each placeholder with actual CSS/SVG/canvas "
            f"code that implements the described visual — do NOT use text descriptions."
        ]
    return []


# ---------------------------------------------------------------------------
# ExepadImage checks
# ---------------------------------------------------------------------------

_EXEPAD_IMAGE_TAG_RE = re.compile(r"<ExepadImage\b([^>]*?)/>", re.DOTALL)


def check_exepad_image_props(tsx: str) -> list[str]:
    """Report if <ExepadImage> is missing keywords or importance prop.

    Also flags keywords with fewer than 5 words — the resolver handles short
    keywords via fallback, but richer keywords yield better stock photo results.

    Presence is checked with a broad regex so JSX expressions like
    `keywords={getKeywords()}` are accepted. The word-count check only runs
    on the literal-string form.
    """
    errors = []
    for m in _EXEPAD_IMAGE_TAG_RE.finditer(tsx):
        props = m.group(1)
        # Skip validation for spread-based tags — props come from the spread object
        if re.search(r"\{\.\.\.", props):
            continue
        if not re.search(r"(?<![\w$-])keywords\s*=", props):
            errors.append(
                "<ExepadImage> missing required `keywords` prop — "
                "add descriptive search keywords (5+ words, English). "
                'Example: keywords="modern bakery interior with fresh bread '
                'and warm lighting"'
            )
        else:
            literal_match = re.search(r"""keywords=\{?["']([^"']+)["']\}?""", props)
            if literal_match:
                word_count = len(literal_match.group(1).split())
                if word_count < 5:
                    errors.append(
                        f"<ExepadImage> keywords has only {word_count} word(s) — "
                        f"use 5+ descriptive words for better stock photo results"
                    )
        if not re.search(r"(?<![\w$-])importance\s*=", props):
            errors.append(
                "<ExepadImage> missing required `importance` prop — " "add importance={1-10} score"
            )
    return errors


def check_exepad_image_duplicate_keywords(tsx: str) -> list[str]:
    """Warn if multiple <ExepadImage> components share identical keywords."""
    keywords_list = re.findall(
        r"""<ExepadImage\b[^>]*?keywords=\{?["']([^"']+)["']\}?""", tsx, re.DOTALL
    )
    if len(keywords_list) >= 2 and len(set(keywords_list)) == 1:
        return [
            f"All {len(keywords_list)} ExepadImage components use the same keywords — "
            f"each image should have unique keywords"
        ]
    return []


def check_exepad_image_dimensions(tsx: str) -> list[str]:
    """Error if <ExepadImage> is missing required `width` or `height` props.

    Explicit width/height attributes are required to prevent layout shift
    (CLS). Without them the browser renders the <img> at 0x0 until the image
    loads, then reflows the page.  We also cap mobile-first requests at
    1200px to prevent over-sized downloads that hurt LCP.
    """
    errors: list[str] = []
    for m in _EXEPAD_IMAGE_TAG_RE.finditer(tsx):
        props = m.group(1)
        # Skip spread-based tags — props come from the spread object
        if re.search(r"\{\.\.\.", props):
            continue
        has_width = re.search(r"(?<![\w$-])width\s*=", props)
        has_height = re.search(r"(?<![\w$-])height\s*=", props)
        width_literal = re.search(r"\bwidth=\{(\d+)\}", props)
        height_literal = re.search(r"\bheight=\{(\d+)\}", props)
        if not has_width:
            errors.append(
                "<ExepadImage> missing required `width` prop — "
                "add width={N} matching the display box. "
                "Required to prevent layout shift (CLS)."
            )
        elif width_literal and int(width_literal.group(1)) > 1200:
            errors.append(
                f"<ExepadImage> width={{{width_literal.group(1)}}} is too large for mobile. "
                f"Use width <= 1200. Mobile-first sizes: 800 (hero), 600 (section), "
                f"400 (card), 200 (avatar)."
            )
        if not has_height:
            errors.append(
                "<ExepadImage> missing required `height` prop — "
                "add height={N} matching the display box. "
                "Required to prevent layout shift (CLS)."
            )
        elif height_literal and int(height_literal.group(1)) > 1200:
            errors.append(
                f"<ExepadImage> height={{{height_literal.group(1)}}} is too large for mobile. "
                f"Use height <= 1200."
            )
    return errors


_TEAM_ROLE_CONTEXT_WORDS = frozenset(
    {
        "role",
        "title",
        "position",
    }
)

_PORTRAIT_ACTION_VERBS = frozenset(
    {
        "checking",
        "examining",
        "holding",
        "working",
        "pouring",
        "mixing",
        "preparing",
        "operating",
        "fixing",
        "assembling",
        "carrying",
        "lifting",
        "writing",
        "typing",
        "cooking",
        "cleaning",
    }
)


def check_team_portrait_keywords(tsx: str) -> list[str]:
    """Warn when a team-member object's image keywords contain action verbs.

    Looks for object literals shaped like::

        { name: "...", role: "...", image: { keywords: "...", ... } }

    and warns when ``keywords`` contains action verbs that pull the stock
    photo search toward bodies-and-tools shots instead of face-forward
    portraits. The runtime resolver (``codefocus_image_resolver._build_image_prop``)
    already strips these verbs for portrait orientation, so this check
    is mostly a nudge — it surfaces in the SSE response so the user can
    iterate on the data array if the auto-strip didn't pick up enough
    context.
    """
    warnings: list[str] = []
    block = re.compile(
        r"""\{[^{}]*?(?:role|title|position)\s*:\s*["'][^"']+["'][^{}]*?image\s*:\s*\{[^{}]*?keywords\s*:\s*["']([^"']+)["'][^{}]*?\}[^{}]*?\}""",
        re.DOTALL | re.IGNORECASE,
    )
    for m in block.finditer(tsx):
        keywords = m.group(1).lower()
        offending = sorted(_PORTRAIT_ACTION_VERBS.intersection(keywords.split()))
        if offending:
            warnings.append(
                f"Team-member portrait keywords contain action verb(s) "
                f"{offending}: '{m.group(1)}'. Use face-forward descriptors "
                f"(e.g. 'professional portrait male brewer') — the resolver "
                f"will strip these but better keywords yield better matches."
            )
    return warnings


def check_status_style_map_case(tsx: str) -> list[str]:
    """Warn when style/variant maps use title-case keys for status-like values.

    D1 stores status values as lowercase (e.g., "paid", "sent", "draft").
    Style maps with title-case keys ("Paid", "Pending") won't match DB values.
    """
    # Match patterns like: { Paid: "...", Pending: "...", Draft: "..." }
    # Only flag when the map has at least 2 title-case keys that look like statuses
    status_words = {
        "Paid",
        "Pending",
        "Sent",
        "Draft",
        "Overdue",
        "Active",
        "Inactive",
        "Completed",
        "Cancelled",
        "Failed",
        "Approved",
        "Rejected",
        "Open",
        "Closed",
        "Processing",
        "Shipped",
        "Delivered",
        "Refunded",
        "Archived",
    }
    # Find object literals with string value entries (style maps)
    for m in re.finditer(
        r"\{([^{}]{20,500})\}",
        tsx,
    ):
        block = m.group(1)
        # Check if this looks like a style map (keys mapping to className strings)
        keys = re.findall(r"(?:^|,|\n)\s*(\w+)\s*:", block)
        title_case_status_keys = [k for k in keys if k in status_words]
        if len(title_case_status_keys) >= 2:
            return [
                f"Style map uses title-case keys ({', '.join(title_case_status_keys)}) "
                f"but D1 stores status values as lowercase. "
                f"Use lowercase keys: {', '.join(k.lower() for k in title_case_status_keys)}"
            ]
    return []


# Status words catalogued in ``tsx_ast.catalog``.
_STATUS_WORDS_LOWER = _CATALOG_STATUS_WORDS_LOWER
_STATUS_WORDS_TITLE = _CATALOG_STATUS_WORDS_TITLE


# ---------------------------------------------------------------------------
# Combined runner
# ---------------------------------------------------------------------------


def _run_component_ast_rules(
    tsx: str,
    *,
    models: list[dict],
    logic: dict,
    handlers: list[dict] | None,
    page_slugs: list[str],
    expected_component_name: str,
    theme_palette: dict[str, str] | None = None,
    handler_sources: dict[str, str] | None = None,
) -> list[Finding]:
    """Run the tree-sitter AST rule set over a component TSX source.

    Parses the TSX once, builds an ``AstContext`` carrying the four
    component-facing catalogs (models / handlers / logic / page_slugs)
    plus the ``expected_export_name``, and returns the sorted Finding
    list. A parse error is reported as a single synthetic Finding so the
    rest of the pipeline still completes — the save tool's syntax stage
    should already have caught the underlying issue, but we don't want a
    malformed TSX to make validation silently pass.
    """
    try:
        tree = parse_tsx(tsx)
    except Exception as exc:  # pragma: no cover — tree-sitter rarely raises
        return [
            Finding(
                rule_id="component.parse.error",
                severity="warning",
                message=f"Tree-sitter parse failed: {type(exc).__name__}: {exc}",
                line=1,
                col=0,
            )
        ]
    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        models=models or [],
        handlers=handlers,
        handler_sources=handler_sources,
        logic=logic or {},
        page_slugs=page_slugs or [],
        expected_export_name=expected_component_name or None,
        theme_palette=theme_palette,
    )
    return run_rules(ctx, component_rules())


def run_semantic_checks(
    tsx: str,
    models: list[dict],
    logic: dict,
    page_slugs: list[str],
    expected_component_name: str = "",
    handlers: list[dict] | None = None,
    theme_palette: dict[str, str] | None = None,
    contrast_warning_ratio: float = 3.0,
    handler_sources: dict[str, str] | None = None,
    stock_provider_configured: bool = True,
) -> SemanticResult:
    """Run all semantic checks on a single component.

    The checks are split across two engines:

    1. Tree-sitter AST rules at ``tsx_ast.rules.component_rules`` — cover
       imports, forbidden APIs, hook safety, cross-references (model /
       handler / state / navigate / icon), JSX shape, and structural
       export-name matching.
    2. Regex checks in this module — cover everything that didn't
       migrate yet (hallucinated URLs, M3 contrast pairings, a11y
       heading order, etc.).

    The AST engine yields ``Finding`` objects which are converted to the
    ``SemanticResult`` string buckets the caller already understands.
    """
    result = SemanticResult()
    component = expected_component_name or "unknown"

    def _collect_errors(check_name: str, errors: list[str]) -> None:
        if errors:
            logger.info(
                "semantic_check_failed",
                check=check_name,
                count=len(errors),
                component=component,
            )
        result.errors += errors

    def _collect_warnings(check_name: str, warnings: list[str]) -> None:
        if warnings:
            logger.debug(
                "semantic_check_warned",
                check=check_name,
                count=len(warnings),
                component=component,
            )
        result.warnings += warnings

    # ── AST rule pass (migrated checks) ──────────────────────────────────
    for finding in _run_component_ast_rules(
        tsx,
        models=models,
        logic=logic,
        handlers=handlers,
        page_slugs=page_slugs,
        expected_component_name=expected_component_name,
        theme_palette=theme_palette,
        handler_sources=handler_sources,
    ):
        bucket = result.errors if finding.severity == "error" else result.warnings
        bucket.append(finding.formatted_message())

    # ── Remaining regex checks ───────────────────────────────────────────
    # The following are deliberately NOT dispatched here; they live in the
    # AST rule engine above (search for the rule id in ``component_rules()``):
    #   - sdk_hook_nullable_access     → UseAppUnsafeAccess + UseModelNullAccess
    #   - undeclared_jsx_handlers      → JsxUndeclaredReferenceRule
    #   - measured_color_contrast      → 5 M3 pairing rules
    #   - header_background            → HeaderBgLowOpacityRule
    # These are deleted as low-yield (zero corpus hits, current LLMs don't emit):
    #   - form_dispatch (dispatch() Redux idiom hallucination)
    #   - css_var_in_canvas (CSS var in Canvas 2D context)
    #   - status_string_literals (covered by status_style_map_case fixer behaviour)
    # The following are now AST rules (Phase 4 ports):
    #   - check_layout_offsets         → LayoutOffsetsRule
    #   - check_overflow_hidden_on_root → OverflowHiddenOnRootRule
    #   - check_inline_font_family     → InlineFontFamilyRule
    #   - check_animate_in_with_bare_duration → AnimateInBareDurationRule
    #   - check_low_opacity_text       → LowOpacityTextRule (component_a11y.py)
    _collect_warnings("enum_coverage", check_enum_coverage(tsx, models))
    _collect_warnings("broken_optional_chain", check_broken_optional_chain(tsx))

    # Hallucinated image URLs are errors, not warnings: the auto-fixer
    # rewrites known-bad domains to ``__PLACEHOLDER__`` before this check
    # runs, so a finding here means the URL slipped past every rewrite
    # (dynamic src, untracked DOM context). Shipping it produces broken
    # images at runtime (e.g. ORB-blocked Wikipedia hot-links).
    _collect_errors(
        "hallucinated_image_urls",
        check_hallucinated_image_urls(tsx, stock_provider_configured),
    )
    _collect_warnings("hallucinated_style_urls", check_hallucinated_style_urls(tsx))
    _collect_warnings("duplicate_image_urls", check_duplicate_image_urls(tsx))
    _collect_errors("placeholder_divs", check_placeholder_divs(tsx))
    _collect_warnings("exepad_image_props", check_exepad_image_props(tsx))
    _collect_warnings("exepad_image_dimensions", check_exepad_image_dimensions(tsx))
    _collect_warnings("exepad_image_duplicate_keywords", check_exepad_image_duplicate_keywords(tsx))
    _collect_warnings("low_opacity_bg", check_low_opacity_bg(tsx))
    _collect_warnings("status_style_map_case", check_status_style_map_case(tsx))
    _collect_warnings("team_portrait_keywords", check_team_portrait_keywords(tsx))

    if result.errors or result.warnings:
        logger.info(
            "Semantic check results",
            component=component,
            error_count=len(result.errors),
            warning_count=len(result.warnings),
            errors=result.errors,
            warnings=[w[:80] for w in result.warnings],
        )

    return result
