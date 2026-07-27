"""SQL extraction from literal strings — sqlparse wrapper.

Once the TSX walker has found a ``.prepare("...")`` literal, this module
answers the question *"what tables does that SQL reference?"* — which is
the minimum needed for ``handler.sql.undeclared_table``. Later rules will
layer column extraction on top using the same ``parse_sql`` entry point.

We deliberately stop short of full SQL semantic analysis. ``sqlparse`` is
a tokenizer with loose statement grouping, not a parser; it understands
SQLite-flavored tokens well enough to identify table names after SQL
verbs (``FROM``, ``JOIN``, ``INTO``, ``UPDATE``) which is the exact scope
the handler builder's Hard Rules govern.

Caveat: sqlparse sometimes classifies a bare table name as a ``Keyword``
token when the table's spelling collides with a SQL reserved word (e.g.
``events``, ``users``, ``order``). The walker therefore accepts any
post-verb token whose text is a plain snake_case identifier and isn't on
the structural-keyword deny-list — regardless of how sqlparse ttyped it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import sqlparse
from sqlparse.sql import Identifier, IdentifierList, Statement
from sqlparse.tokens import Keyword, Name


@dataclass(frozen=True)
class SqlRef:
    """One (verb, table) pair extracted from a SQL statement."""

    verb: str  # "FROM" | "JOIN" | "INSERT" | "UPDATE" | "DELETE"
    table: str  # lowercase, quotes stripped, schema prefix removed


@dataclass
class SqlAnalysis:
    """Result of analysing a SQL literal.

    ``refs`` carries the (verb, table) pairs in source order. ``statement_count``
    is the number of top-level statements sqlparse produced; anything above 1
    is unusual for ``.prepare()`` bodies and useful to surface in error
    messages. ``column_refs`` lists ``table.column`` qualified references.
    """

    refs: list[SqlRef] = field(default_factory=list)
    statement_count: int = 0
    column_refs: list[tuple[str, str]] = field(default_factory=list)  # (table, column)
    # Bare (unqualified) column names from high-signal positions (GROUP BY /
    # ORDER BY items, predicate left-hand sides). Resolvable to a table only
    # when the statement touches exactly one table — see ``undeclared_column``.
    bare_columns: list[str] = field(default_factory=list)
    # Table-alias map: ``{alias_lower: table_lower}`` from ``FROM t x`` / ``JOIN
    # t AS x``. Lets callers resolve a qualified ``x.col`` reference back to its
    # real table. Empty when a statement uses no aliases.
    aliases: dict[str, str] = field(default_factory=dict)

    def tables(self) -> set[str]:
        return {r.table for r in self.refs}

    def resolve_table(self, name: str) -> str:
        """Map an alias back to its real table name (identity if not an alias)."""
        return self.aliases.get(name.lower(), name.lower())


_IDENT_RE = re.compile(r"^[A-Za-z_][\w]*$")


# Structural SQL keywords that can legally follow a verb but are NEVER table
# names. Any post-verb token whose UPPER text lands in this set is skipped
# so we don't capture "JOIN" as a table after "FROM".
_STRUCTURAL_KEYWORDS: frozenset[str] = frozenset(
    {
        "SELECT",
        "FROM",
        "WHERE",
        "GROUP",
        "ORDER",
        "HAVING",
        "LIMIT",
        "OFFSET",
        "JOIN",
        "LEFT",
        "RIGHT",
        "INNER",
        "OUTER",
        "CROSS",
        "NATURAL",
        "FULL",
        "ON",
        "USING",
        "AS",
        "UNION",
        "INTERSECT",
        "EXCEPT",
        "VALUES",
        "SET",
        "INTO",
        "WHEN",
        "THEN",
        "ELSE",
        "END",
        "CASE",
        "AND",
        "OR",
        "NOT",
        "NULL",
        "TRUE",
        "FALSE",
        "IS",
        "IN",
        "LIKE",
        "BETWEEN",
        "EXISTS",
        "ALL",
        "ANY",
        "SOME",
        "DISTINCT",
        "RETURNING",
        "DEFAULT",
        "CURRENT_DATE",
        "CURRENT_TIME",
        "CURRENT_TIMESTAMP",
    }
)


def _normalize_ident(raw: str) -> str:
    """Normalize a table identifier token to a bare lowercase name.

    Strips surrounding quotes (``"``, `` ` ``, ``[]``), drops schema prefixes
    (``main.users`` → ``users``), drops alias suffixes (``guests g`` →
    ``guests``), lowercases. Returns an empty string if the token is not a
    valid bare identifier after stripping.
    """
    stripped = raw.strip().strip('`"[]').strip()
    # Alias: "guests AS g" or "guests g" — the leading word is the table.
    if " " in stripped:
        stripped = stripped.split()[0]
    if "." in stripped:
        stripped = stripped.rsplit(".", 1)[-1]
    stripped = stripped.strip('`"[]').strip()
    if not _IDENT_RE.match(stripped):
        return ""
    if stripped.upper() in _STRUCTURAL_KEYWORDS:
        return ""
    return stripped.lower()


def _extract_identifier_texts(token) -> list[str]:
    """Return raw identifier text for an Identifier, IdentifierList, or plain Token.

    ``IdentifierList`` arises when sqlparse groups a comma-separated list —
    rare after a verb but handled defensively. Plain tokens (including
    mis-typed Keyword) return their raw text, which the normalizer then
    filters.
    """
    if isinstance(token, IdentifierList):
        return [str(ident) for ident in token.get_identifiers()]
    if isinstance(token, Identifier):
        return [str(token)]
    return [str(token)]


def _is_verb_token(tok) -> str | None:
    """Return the verb label if ``tok`` is a table-introducing SQL verb.

    Matches ``FROM``, ``JOIN`` (including compound spellings like
    ``"LEFT JOIN"`` that sqlparse returns as a single Keyword token),
    ``UPDATE`` (a DML token), and ``INTO`` (a Keyword). Any other
    keyword or token type yields ``None``.
    """
    ttype = tok.ttype
    if ttype is None:
        return None
    upper = tok.normalized.upper() if tok.normalized else ""
    if upper == "UPDATE":
        return "UPDATE"
    if upper == "FROM":
        return "FROM"
    if upper == "INTO":
        return "INSERT"
    if "JOIN" in upper:
        return "JOIN"
    return None


def _walk_statement(stmt: Statement) -> list[SqlRef]:
    """Walk a single sqlparse Statement and emit (verb, table) pairs.

    State machine: on every verb keyword we scan forward for the immediately
    next identifier-bearing token. sqlparse may classify a table that
    collides with a reserved word as a ``Keyword`` — we still accept it as
    long as its text is a bare identifier that isn't in
    ``_STRUCTURAL_KEYWORDS``. This is the critical fix for tables like
    ``events``, ``users``, ``order`` that the generated handlers frequently
    hit.
    """
    refs: list[SqlRef] = []
    tokens = [t for t in stmt.tokens if not t.is_whitespace]

    i = 0
    while i < len(tokens):
        verb = _is_verb_token(tokens[i])
        if verb is None:
            i += 1
            continue

        # Look ahead for the next token that contains a table name.
        j = i + 1
        while j < len(tokens):
            nxt = tokens[j]

            # Identifier / IdentifierList — the happy path.
            if isinstance(nxt, (Identifier, IdentifierList)):
                for raw in _extract_identifier_texts(nxt):
                    name = _normalize_ident(raw)
                    if name:
                        refs.append(SqlRef(verb=verb, table=name))
                break

            # Plain Token — sqlparse often mis-types a reserved-word table
            # name as Keyword here. Accept if the raw text normalizes to a
            # bare identifier and isn't a structural keyword.
            if nxt.ttype in (Keyword, Name) or nxt.ttype is None:
                name = _normalize_ident(str(nxt))
                if name:
                    refs.append(SqlRef(verb=verb, table=name))
                    break
                # Not a table token — keep scanning (e.g. parenthesised
                # subquery or a comment).
                j += 1
                continue

            # Wildcard (SELECT *), punctuation, literals, etc. — stop
            # scanning for this verb; we won't find a table after these.
            break

        i = j + 1 if j < len(tokens) else i + 1

    return refs


_QUALIFIED_REF_RE = re.compile(r"\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\b")

# ``FROM|JOIN <table> [AS] <alias>`` — captures a table and its optional alias.
# Quotes/brackets are tolerated on either name. A non-alias follower (WHERE, ON,
# a compound JOIN keyword, ...) is filtered out by the _STRUCTURAL_KEYWORDS guard.
_TABLE_ALIAS_RE = re.compile(
    r"\b(?:FROM|JOIN)\s+([`\"\[]?[A-Za-z_][\w.]*[`\"\]]?)"
    r"(?:\s+(?:AS\s+)?([`\"\[]?[A-Za-z_]\w*[`\"\]]?))?",
    re.IGNORECASE,
)


def _extract_table_aliases(sql: str) -> dict[str, str]:
    """Build ``{alias_lower: real_table_lower}`` from FROM/JOIN clauses.

    String literals are stripped first so a value like ``'x.y'`` never seeds a
    bogus alias. A follower token that is a structural keyword (``WHERE``,
    ``ON``, ``LEFT``, ...) is not an alias and is skipped, so a plain
    ``FROM tasks WHERE`` yields no alias. Comma-joins only capture the first
    table's alias — an acceptable, conservative limit (no false mappings).
    """
    if not sql:
        return {}
    stripped = re.sub(r"'(?:[^'\\]|\\.)*'", "''", sql)
    out: dict[str, str] = {}
    for m in _TABLE_ALIAS_RE.finditer(stripped):
        table = _normalize_ident(m.group(1))
        alias_raw = m.group(2)
        if not table or not alias_raw:
            continue
        alias = alias_raw.strip('`"[]').strip().lower()
        if not _IDENT_RE.match(alias) or alias.upper() in _STRUCTURAL_KEYWORDS:
            continue
        out[alias] = table
    return out


def _extract_column_refs(sql: str) -> list[tuple[str, str]]:
    """Extract qualified ``table.column`` references from a SQL literal.

    Returns ``[("table", "column"), ...]`` for every dotted name that
    matches ``t.c``. String literals are stripped first so contents like
    ``'order.item'`` never appear in the output. This is a tokenizer-level
    extractor, not a parser — it is deliberately liberal and the
    ``undeclared_column`` rule only uses qualified refs to produce findings
    so false positives stay rare.

    Bare (unqualified) column names are intentionally not returned: they
    cannot be resolved to a table without alias tracking, which is a
    frequent source of false positives.
    """
    if not sql:
        return []

    # Strip string literals so we don't pick up ``'order.item'`` as a ref.
    stripped = re.sub(r"'(?:[^'\\]|\\.)*'", "''", sql)
    stripped = re.sub(r'"(?:[^"\\]|\\.)*"', '""', stripped)

    return [(m.group(1).lower(), m.group(2).lower()) for m in _QUALIFIED_REF_RE.finditer(stripped)]


# Tokens that legally follow a column in GROUP BY / ORDER BY items but are not
# themselves columns.
_ORDER_NOISE: frozenset[str] = frozenset(
    {"ASC", "DESC", "COLLATE", "NULLS", "FIRST", "LAST", "NOCASE", "BINARY", "RTRIM"}
)

# A column on the left-hand side of a comparison/predicate operator. The token
# immediately before ``=`` / ``!=`` / ``<`` / ``>`` / ``LIKE`` / ``IN`` / ``IS``
# is (in single-table statements) a column. Function calls don't match because a
# ``)`` — not an identifier — precedes the operator.
_PREDICATE_LHS_RE = re.compile(
    r"\b([A-Za-z_]\w*)\s*(?:!=|<>|<=|>=|=|<|>|\bLIKE\b|\bIN\b|\bIS\b)",
    re.IGNORECASE,
)

# The GROUP BY / ORDER BY clause body, up to the next clause boundary.
_GROUP_ORDER_RE = re.compile(
    r"\b(?:GROUP|ORDER)\s+BY\s+(.*?)"
    r"(?:\bHAVING\b|\bLIMIT\b|\bOFFSET\b|\bUNION\b|\bGROUP\s+BY\b|\bORDER\s+BY\b|\)|;|$)",
    re.IGNORECASE | re.DOTALL,
)


def _extract_bare_columns(sql: str) -> list[str]:
    """Extract bare column names from high-signal, low-false-positive positions.

    Targets the single-table aggregation / filter case the handler builder
    frequently mis-generates (e.g. ``SELECT status, COUNT(*) FROM loans GROUP BY
    status``). We deliberately ignore SELECT-list identifiers (aliases,
    expressions, function args make them ambiguous) and only read:

    * ``GROUP BY`` / ``ORDER BY`` items (skipping function calls + ASC/DESC), and
    * the left-hand side of comparison predicates.

    The caller resolves these against a table only when the statement touches
    exactly one table, so alias ambiguity never arises.
    """
    if not sql:
        return []

    # Strip string literals + quoted identifiers, then blank out qualified refs
    # so neither side of ``t.c`` is mistaken for a bare column.
    s = re.sub(r"'(?:[^'\\]|\\.)*'", "''", sql)
    s = re.sub(r'"(?:[^"\\]|\\.)*"', '""', s)
    s = _QUALIFIED_REF_RE.sub(" ", s)

    out: list[str] = []

    def _add(token: str) -> None:
        t = token.strip().lower()
        if not t or not _IDENT_RE.match(t):
            return
        upper = t.upper()
        if upper in _STRUCTURAL_KEYWORDS or upper in _ORDER_NOISE:
            return
        out.append(t)

    for m in _GROUP_ORDER_RE.finditer(s):
        for item in m.group(1).split(","):
            item = item.strip()
            if not item:
                continue
            head = item.split()[0]
            if "(" in head:  # function call, e.g. date(created_at) — skip
                continue
            _add(head)

    for m in _PREDICATE_LHS_RE.finditer(s):
        _add(m.group(1))

    return out


def parse_sql(sql: str) -> SqlAnalysis:
    """Parse a SQL literal and return its table + column references.

    Safe on malformed input: sqlparse is lenient and returns whatever it
    could group, and we only emit refs the walker identified unambiguously.
    An empty or whitespace-only input returns an empty analysis.
    """
    if not sql or not sql.strip():
        return SqlAnalysis()

    try:
        statements = sqlparse.parse(sql)
    except Exception:
        return SqlAnalysis()

    analysis = SqlAnalysis(statement_count=len(statements))
    for stmt in statements:
        analysis.refs.extend(_walk_statement(stmt))

    analysis.column_refs = _extract_column_refs(sql)
    analysis.bare_columns = _extract_bare_columns(sql)
    analysis.aliases = _extract_table_aliases(sql)
    return analysis
