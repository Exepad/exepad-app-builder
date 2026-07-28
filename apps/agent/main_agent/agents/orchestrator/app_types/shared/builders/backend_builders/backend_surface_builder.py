"""
Backend surface builder for ComponentBuilder agent.

Builds a ``BackendSurface`` JSON string that bundles:
- Model schemas (columns, owner_scope) + usage guide
- Handler signatures (inputs, outputs, type) + usage guide
- File storage config + usage guide
- Auth/security context (roles, providers, page access)

Each surface section carries its own guide doc so the LLM sees
the reference material next to the data it describes.

The surface is the **sole source of truth** for frontend↔backend
interaction patterns in the component builder instruction chain.
"""

import csv
import io
import re
import structlog
from pydantic import BaseModel, Field
from main_agent.agents.utils.agent_docs_loader import load_agent_doc

logger = structlog.get_logger(__name__)


# =============================================================================
# Helpers
# =============================================================================


def _load_guide(path: str) -> str:
    """Load a guide doc, returning empty string on failure."""
    try:
        return load_agent_doc(path)
    except FileNotFoundError:
        logger.warning("Guide doc not found", path=path)
        return ""


# =============================================================================
# Seed-based ``enum_values`` sampling (P3)
# =============================================================================


# Distinct-count window for seed-derived enums. Below 2 the column is
# constant (not interesting); above 8 the column is plausibly free text
# (city, country, sku, hash, free-form label) and a finite enum would
# over-constrain. Window confirmed with user 2026-05-14.
_ENUM_SAMPLE_MIN: int = 2
_ENUM_SAMPLE_MAX: int = 8

# Columns we never sample, even when distinct is in window. These are
# always identifiers / opaque tokens that happen to have low cardinality
# in tiny seed CSVs but are NOT closed enumerations.
_ENUM_SAMPLE_EXCLUDED_COLS: frozenset[str] = frozenset(
    {
        "id",
        "owner_id",
        "uuid",
        "created_at",
        "updated_at",
        "email",
        "phone",
        "password",
        "token",
        "hash",
    }
)

# Column-name patterns that are NOT closed vocabularies even when a tiny seed
# makes them look low-cardinality. On a 5–8 row demo seed almost every
# free-text / identifier column (name, company, notes, due_date, tax_id, …)
# lands in the [2,8] distinct-count window and would be wrongly locked to a
# finite enum — seen live on app amukkmasq (2026-06-27): clients.name → 5
# person names, clients.company → 5 firms, invoices.notes → 8 strings,
# invoices.due_date → 8 date tokens. A name-based denylist is the precise gate:
# genuine enum columns (status/state/type/category/tier/plan/priority/…) are
# never free-text-named, so excluding these never blocks a real closed vocab.
_ENUM_FREE_TEXT_COLS: frozenset[str] = frozenset(
    {
        "name",
        "title",
        "label",
        "heading",
        "headline",
        "subtitle",
        "description",
        "desc",
        "notes",
        "note",
        "comment",
        "comments",
        "summary",
        "content",
        "body",
        "message",
        "bio",
        "biography",
        "about",
        "address",
        "company",
        "organization",
        "org",
        "username",
        "slug",
        "url",
        "link",
        "image",
        "img",
        "avatar",
        "photo",
        "date",
        "due_date",
        "datetime",
        "timestamp",
        "tax_id",
        # Free-text person / entity NAME columns — always free text, never a
        # closed vocabulary (app a1a73orsx 2026-07-12: books.author → 8 distinct
        # person names sampled into an enum). The value-based no-repetition guard
        # (_ENUM_MIN_REPEAT_SAMPLES) is the general net; these names cover the
        # small-seed case where that guard can't yet be sure.
        "author",
        "artist",
        "writer",
        "publisher",
        "editor",
        "director",
        "creator",
        "designer",
        "manufacturer",
        "vendor",
        "supplier",
        "customer",
        "client",
        "recipient",
        "sender",
        "assignee",
        "reporter",
        "contact",
        "guest",
        "attendee",
        "participant",
        "speaker",
        "instructor",
        "owner",
        "person",
        "firstname",
        "lastname",
        "fullname",
        "nickname",
    }
)

# Name suffixes that mark identifiers / free text / timestamps regardless of the
# base word: company_name, billing_address, start_date, created_at, file_url, …
_ENUM_FREE_TEXT_SUFFIXES: tuple[str, ...] = (
    "_id",
    "_name",
    "_url",
    "_at",
    "_date",
    "_email",
    "_phone",
    "_address",
    "_description",
    "_notes",
    "_slug",
    "_token",
    "_by",  # created_by / added_by / reported_by → a person identifier, free text
)

# A closed vocabulary is INFERRED from repeated values. When a column has this
# many non-null seed samples and EVERY one is distinct, there is no repetition
# evidence, so it is an identifier / free-text name — not an enum. Below this
# count the seed is too small to tell a 4-value enum from 4 unique names, so we
# leave those to the name denylist and default to sampling.
_ENUM_MIN_REPEAT_SAMPLES: int = 5


def _is_free_text_or_identifier_column(name: str) -> bool:
    """True when a column NAME marks free text / an identifier / a timestamp —
    never a closed vocabulary — so the seed-enum sampler must skip it even when
    a tiny seed makes its distinct count fall inside the sampling window."""
    n = name.strip().lower()
    if n in _ENUM_FREE_TEXT_COLS:
        return True
    return n.endswith(_ENUM_FREE_TEXT_SUFFIXES)


# Column names that STRONGLY signal a closed vocabulary (status / type / size /
# priority / …). These are exempt from the value-based no-repetition guard: a
# demo seed authored as one row per value (all-distinct) is a natural shape for
# a status/type column, and skipping it would silently disable this feature for
# the exact eiu7xj0v case it exists to fix. Sampling a known-enum name even when
# all-distinct only ever adds a build-time coverage hint, never a runtime
# constraint, so the downside is nil.
_ENUM_LIKELY_COLS: frozenset[str] = frozenset(
    {
        "status",
        "state",
        "type",
        "kind",
        "category",
        "subcategory",
        "priority",
        "tier",
        "plan",
        "level",
        "stage",
        "phase",
        "mode",
        "severity",
        "size",
        "color",
        "colour",
        "condition",
        "gender",
        "role",
        "department",
        "difficulty",
        "sentiment",
        "visibility",
        "grade",
        "format",
        "quality",
        "direction",
        "segment",
    }
)
_ENUM_LIKELY_SUFFIXES: tuple[str, ...] = (
    "_status",
    "_state",
    "_type",
    "_kind",
    "_category",
    "_priority",
    "_tier",
    "_level",
    "_stage",
    "_phase",
    "_mode",
    "_severity",
    "_size",
    "_gender",
    "_role",
    "_condition",
    "_grade",
)


def _is_enum_likely_column(name: str) -> bool:
    """True when a column NAME strongly signals a closed vocabulary, so the
    no-repetition guard must NOT skip it even when a tiny seed is all-distinct."""
    n = name.strip().lower()
    return n in _ENUM_LIKELY_COLS or n.endswith(_ENUM_LIKELY_SUFFIXES)


# A relative-date SEED token (``__TODAY__``, ``__NOW__`` with optional offsets)
# or an ISO date / datetime literal. A date column seeded with these is a
# timestamp, not a closed vocabulary — see ``_values_are_dates``.
_SEED_DATE_TOKEN_RE = re.compile(r"^__(TODAY|NOW)__")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)")


def _values_are_dates(values: set[str]) -> bool:
    """True when EVERY distinct seed value is a relative-date token or an ISO
    date/datetime — i.e. the column is a timestamp, not an enumeration.

    The name denylist (``_ENUM_FREE_TEXT_*``) can't enumerate every date column
    (``date_added``, ``logged_on``, ``hike_date`` all slip past it), so a
    value-based guard is the general gate. App aqyxejmw5 (2026-07-12) shipped
    ``date_added`` with 8 ``__TODAY__-<n>d`` seed tokens sampled straight into
    ``enum_values`` — the tokens then leak into runtime filter dropdowns and
    lock a timestamp to a finite set.

    Trade-off: a rare *date-keyed category* column (e.g. a ``billing_period``
    seeded with a handful of exact ISO dates) also looks like a row of dates and
    is skipped. That costs only a build-time coverage hint — the sampler writes
    the snake ``enum_values`` used by the coverage validators, NOT the runtime
    ``enumValues`` constraint — so no data-integrity regression, and dropping a
    date column from the enum surface is the correct call far more often than
    not."""
    if not values:
        return False
    return all(bool(_SEED_DATE_TOKEN_RE.match(v) or _ISO_DATE_RE.match(v)) for v in values)


def sample_enum_values_from_seed_csv(
    model: dict,
    seed_csv: str,
    *,
    min_distinct: int = _ENUM_SAMPLE_MIN,
    max_distinct: int = _ENUM_SAMPLE_MAX,
) -> list[str]:
    """Populate ``enum_values`` on a model's text columns from seed data.

    Mutates ``model["columns"][i]["enum_values"]`` in place for each
    text column whose distinct seed-value count is in
    ``[min_distinct, max_distinct]`` AND that does not already have
    ``enum_values`` declared (Creator-authored values win — we only
    fill the gap).

    Returns the list of column names whose ``enum_values`` were
    populated by this call. Empty list if no changes.

    Bug class motivation: app eiu7xj0v (2026-05-14). The seed CSVs
    had `orders.status` with 6 distinct values
    (delivered/shipped/paid/refunded/pending/cancelled), but Creator
    declared `enum_values: null` because the model wasn't a known
    closed-vocab status. Components ended up with switch/case branches
    that missed real values; OrdersContent's filter strip omitted
    `delivered` (the biggest bucket). Once `enum_values` is populated,
    three existing validators fire automatically (``check_enum_coverage``,
    ``FilterEnumCaseMismatchRule``, ``HandlerSqlEnumCaseRule``).

    Args:
        model: A model dict from ``backend_config["models"]``. Must
            contain ``columns`` (list of column dicts).
        seed_csv: The raw CSV contents (UTF-8 string).
        min_distinct: Inclusive lower bound on distinct count to sample.
        max_distinct: Inclusive upper bound on distinct count to sample.

    Returns:
        Names of columns where ``enum_values`` was newly populated.
    """
    columns = model.get("columns")
    if not isinstance(columns, list):
        return []
    if not seed_csv:
        return []
    try:
        reader = csv.DictReader(io.StringIO(seed_csv))
        rows = list(reader)
    except csv.Error:
        return []
    if not rows:
        return []

    # Build a quick lookup of distinct values (and non-null sample count) per
    # column from the seed. CSV header → distinct set; skip empty / "null".
    distinct: dict[str, set[str]] = {}
    nonnull_count: dict[str, int] = {}
    for row in rows:
        for col_name, raw in row.items():
            if col_name is None:
                continue
            if raw is None:
                continue
            v = raw.strip()
            if v == "" or v.lower() == "null":
                continue
            distinct.setdefault(col_name, set()).add(v)
            nonnull_count[col_name] = nonnull_count.get(col_name, 0) + 1

    populated: list[str] = []
    for col in columns:
        if not isinstance(col, dict):
            continue
        name = col.get("name")
        if not isinstance(name, str) or not name:
            continue
        if name in _ENUM_SAMPLE_EXCLUDED_COLS:
            continue
        # Free-text / identifier / timestamp columns are never closed vocabs,
        # even when a tiny demo seed makes their distinct count look enum-like.
        if _is_free_text_or_identifier_column(name):
            continue
        # Only sample for text-shaped columns. Numeric/boolean enums are
        # uncommon and risk over-restricting things like rating values.
        col_type = (col.get("type") or "text").lower()
        if col_type not in ("text", "string"):
            continue
        # Don't overwrite Creator-declared enum_values.
        if col.get("enum_values") or col.get("enumValues"):
            continue
        values = distinct.get(name)
        if not values:
            continue
        # Timestamps are never a closed vocabulary. A date column (however
        # named) whose seed values are relative-date tokens or ISO dates must
        # not be sampled — that pollutes runtime filter dropdowns and locks a
        # timestamp to a finite set. Value-based, so it generalizes past the
        # _ENUM_FREE_TEXT_* name lists that missed date_added on app aqyxejmw5.
        if _values_are_dates(values):
            continue
        if not (min_distinct <= len(values) <= max_distinct):
            continue
        # No-repetition guard: an enum is inferred from REPEATED values. With
        # enough non-null samples all distinct, there is no repetition evidence,
        # so the column is an identifier / free-text name (author, company, …),
        # not a closed vocabulary — skip. Generalizes past the name denylist
        # (app a1a73orsx: books.author → 8 distinct person names in 8 rows).
        # A column whose NAME strongly signals a closed vocab (status/type/size/…)
        # is exempt: a one-row-per-value demo seed is natural for it, and skipping
        # would disable the sampler for the very case it exists to fix.
        if (
            len(values) == nonnull_count.get(name, 0)
            and len(values) >= _ENUM_MIN_REPEAT_SAMPLES
            and not _is_enum_likely_column(name)
        ):
            continue
        # Write the snake_case ``enum_values`` key INTENTIONALLY. The agent-side
        # validators (check_enum_coverage / FilterEnumCaseMismatchRule /
        # HandlerSqlEnumCaseRule) read both casings, so this build-time coverage
        # hint takes effect; the runtime schema uses camelCase ``enumValues`` and
        # ignores this key, which is the desired behavior — a seed-derived enum
        # is sampled from a small demo set and may be INCOMPLETE, so it must not
        # become a runtime constraint that rejects valid non-seed values. Only a
        # Creator-declared (camelCase) enum is trusted to enforce at runtime.
        col["enum_values"] = sorted(values)
        populated.append(name)
    return populated


def sample_enum_values_for_models(
    backend_config: dict | None,
    seed_csvs: dict[str, str],
    *,
    min_distinct: int = _ENUM_SAMPLE_MIN,
    max_distinct: int = _ENUM_SAMPLE_MAX,
) -> dict[str, list[str]]:
    """Apply ``sample_enum_values_from_seed_csv`` to every model in
    ``backend_config["models"]`` for which a seed CSV is available.

    Returns ``{model_name: [populated_column_names]}`` for telemetry /
    logging. Empty dict if no changes.

    ``seed_csvs`` is keyed by model name (matching
    ``model["name"]``). Models without a seed entry are skipped.
    """
    if not backend_config:
        return {}
    models = backend_config.get("models") or []
    out: dict[str, list[str]] = {}
    for m in models:
        if not isinstance(m, dict):
            continue
        name = m.get("name")
        if not isinstance(name, str):
            continue
        csv_text = seed_csvs.get(name)
        if not csv_text:
            continue
        populated = sample_enum_values_from_seed_csv(
            m, csv_text, min_distinct=min_distinct, max_distinct=max_distinct
        )
        if populated:
            out[name] = populated
    return out


# =============================================================================
# Surface Models
# =============================================================================


class ModelColumnSurface(BaseModel):
    """A single column in a model's API surface.

    ``enum_values`` (optional): closed vocabulary of allowed values for
    status/priority/category columns. When set, component code MUST
    render every value explicitly — the ``default`` branch of a switch
    or the fallback of a map is reserved for genuinely unexpected data,
    not for business labels. See ``check_enum_coverage`` in
    ``semantic_validator.py``.
    """

    name: str
    type: str
    enum_values: list[str] | None = None


class ModelsSurface(BaseModel):
    """Models API surface exposed to code components.

    Contains all model schemas plus the usage guide that explains
    useModel hook, CRUD patterns, auto-refetch, conditional fetching,
    owner scope behavior, and status/enum rules.
    """

    items: list["ModelSurface"] = Field(default_factory=list)
    guide: str = ""


class ModelSurface(BaseModel):
    """A single model's API surface."""

    name: str
    columns: list[ModelColumnSurface]
    owner_scope: str = "user"


class HandlerInputOutput(BaseModel):
    """A single input or output parameter of a handler."""

    name: str
    type: str = "string"


class HandlersSurface(BaseModel):
    """Handlers API surface exposed to code components.

    Contains all handler signatures plus the usage guide that explains
    useHandler hook, autoFetch, read vs write patterns, error handling,
    chart data binding, and field name contract.
    """

    items: list["HandlerSurface"] = Field(default_factory=list)
    guide: str = ""


class HandlerSurface(BaseModel):
    """A single handler's API surface."""

    name: str
    summary: str = ""
    handler_type: str = "write"
    inputs: list[HandlerInputOutput] = Field(default_factory=list)
    outputs: list[HandlerInputOutput] = Field(default_factory=list)


class StorageSurface(BaseModel):
    """Storage API surface exposed to code components.

    Contains storage config plus the usage guide that explains
    useFileUpload, buildFileUrl, file listing, and upload patterns.
    """

    enabled: bool = True
    max_file_size: int = 10485760  # in bytes (10 MB default)
    allowed_mime_types: list[str] = Field(default_factory=list)
    public_access: bool = False
    guide: str = ""


class SecuritySurface(BaseModel):
    """Auth/security context for code components.

    Tells the component builder whether the app requires authentication,
    which roles exist, and what page-level access controls are set.
    Components use useCurrentUser() to access auth state.
    """

    needs_auth: bool = False
    auth_providers: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    default_access: str = "public"
    page_access: dict = Field(default_factory=dict)
    guide: str = ""


class BackendSurface(BaseModel):
    """Complete backend API surface for code components.

    Each section carries its own guide doc so the LLM sees
    reference material next to the data it describes.
    """

    models: ModelsSurface | None = None
    handlers: HandlersSurface | None = None
    storage: StorageSurface | None = None
    security: SecuritySurface | None = None


# =============================================================================
# Builder
# =============================================================================


def build_backend_surface(
    backend_config: dict | None,
    *,
    security_plan: dict | None = None,
    security_config: dict | None = None,
    app_secondary_type: str = "website",
) -> str:
    """Build a JSON backend surface string for ComponentBuilder.

    Extracts models, handlers, and storage into a minimal API surface,
    each with its own usage guide. Attaches auth/security context.
    Returns empty string if nothing to surface.

    Args:
        backend_config: The ``backend`` dict from app_config or backend.json.
        security_plan: From ``plan["app_security_plan"]`` (creation flow,
            snake_case keys: ``needs_auth``, ``auth_providers``, ``roles``,
            ``default_access``, ``page_access``).
        security_config: From ``app_config["security"]`` (editing flow,
            camelCase keys: ``authProviders``, ``roles``, ``defaultAccess``,
            ``pageAccess``).
        app_secondary_type: ``website``/``form``/``dataapp``/``custom``.
    """
    models_raw = (backend_config or {}).get("models", [])
    handlers_raw = (backend_config or {}).get("handlers", [])
    storage_raw = (backend_config or {}).get("storage")

    has_backend = bool(models_raw or handlers_raw or storage_raw)

    # ── Security ──────────────────────────────────────────────────────────
    security = None
    if security_plan and security_plan.get("needs_auth"):
        security = SecuritySurface(
            needs_auth=True,
            auth_providers=security_plan.get("auth_providers", ["email"]),
            roles=security_plan.get("roles", []),
            default_access=security_plan.get("default_access", "authenticated"),
            page_access=security_plan.get("page_access", {}),
        )
    elif security_config and security_config.get("authProviders"):
        # Normalize authProviders — may be list[str] or list[dict] with "provider" key
        raw_providers = security_config.get("authProviders", [])
        auth_providers = [p["provider"] if isinstance(p, dict) else p for p in raw_providers]
        security = SecuritySurface(
            needs_auth=True,
            auth_providers=auth_providers,
            roles=security_config.get("roles", []),
            default_access=security_config.get("defaultAccess", "authenticated"),
            page_access=security_config.get("pageAccess", {}),
        )

    # Return empty string if nothing to surface
    if not has_backend and not security:
        return ""

    # ── Security guide ───────────────────────────────────────────────────
    if security:
        security.guide = _load_guide("surfaces/backend_surface/docs/14_AUTH_SECURITY_GUIDE.md")

    # ── Models ────────────────────────────────────────────────────────────
    models_surface = None
    model_items = [
        ModelSurface(
            name=m.get("name", ""),
            columns=[
                ModelColumnSurface(
                    name=c["name"],
                    type=c.get("type", "text"),
                    # Accept both snake_case (from ColumnPlan) and camelCase
                    # (from persisted app config) so this helper is agnostic
                    # to which producer supplied the dict.
                    enum_values=c.get("enum_values") or c.get("enumValues"),
                )
                for c in m.get("columns", [])
                if isinstance(c, dict) and c.get("name")
            ],
            owner_scope=m.get("ownerScope", "user"),
        )
        for m in models_raw
        if isinstance(m, dict)
    ]
    if model_items:
        models_surface = ModelsSurface(
            items=model_items,
            guide=_load_guide("surfaces/backend_surface/docs/07_BACKEND_MODELS_GUIDE.md"),
        )

    # ── Handlers ──────────────────────────────────────────────────────────
    handlers_surface = None
    handler_items = [
        HandlerSurface(
            name=h.get("name", ""),
            summary=h.get("summary", ""),
            handler_type=h.get("handlerType", "write"),
            inputs=[
                HandlerInputOutput(name=inp.get("name", ""), type=inp.get("type", "string"))
                for inp in h.get("inputs", [])
                if isinstance(inp, dict)
            ],
            outputs=[
                HandlerInputOutput(name=out.get("name", ""), type=out.get("type", "string"))
                for out in h.get("outputs", [])
                if isinstance(out, dict)
            ],
        )
        for h in handlers_raw
        if isinstance(h, dict)
    ]
    if handler_items:
        handlers_surface = HandlersSurface(
            items=handler_items,
            guide=_load_guide("surfaces/backend_surface/docs/08_BACKEND_HANDLERS_GUIDE.md"),
        )

    # ── Storage ───────────────────────────────────────────────────────────
    storage = None
    if isinstance(storage_raw, dict) and storage_raw.get("enabled"):
        storage = StorageSurface(
            enabled=True,
            max_file_size=int(storage_raw.get("maxFileSize", 10485760)),
            allowed_mime_types=storage_raw.get("allowedMimeTypes", []),
            public_access=bool(storage_raw.get("publicAccess", False)),
            guide=_load_guide("surfaces/backend_surface/docs/09_FILE_STORAGE_GUIDE.md"),
        )

    surface = BackendSurface(
        models=models_surface,
        handlers=handlers_surface,
        storage=storage,
        security=security,
    )
    return surface.model_dump_json(exclude_none=True)
