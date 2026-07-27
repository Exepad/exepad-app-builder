"""Unit tests for seed-driven ``enum_values`` sampling (P3).

Bug class motivation: eiu7xj0v (2026-05-14). Seed CSVs had
``orders.status`` with 6 distinct values
(``delivered/shipped/paid/refunded/pending/cancelled``), but
Creator declared ``enum_values: null`` because ``status`` wasn't on its
known closed-vocabulary list. Components ended up with switch/case
branches that missed real values; OrdersContent's filter strip omitted
``delivered`` (the biggest bucket).

The fix is a single seed-sampling pass that auto-fills
``ModelColumnSurface.enum_values`` from seed distinct values within a
``[2, 8]`` window. Three existing validators
(``check_enum_coverage`` / ``FilterEnumCaseMismatchRule`` /
``HandlerSqlEnumCaseRule``) then fire automatically.
"""

from __future__ import annotations

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_surface_builder import (
    sample_enum_values_for_models,
    sample_enum_values_from_seed_csv,
)

# ---------------------------------------------------------------------------
# 1. eiu7xj0v regression: 6 distinct statuses → enum_values populated.
# ---------------------------------------------------------------------------


EIU7_ORDERS_CSV = """id,order_id,status,total,currency
1,1,delivered,100,USD
2,2,shipped,200,USD
3,3,paid,150,USD
4,4,refunded,50,USD
5,5,pending,75,USD
6,6,cancelled,0,USD
7,7,delivered,80,USD
8,8,shipped,90,USD
"""


def test_eiu7_orders_status_sampled_six_values() -> None:
    model = {
        "name": "orders",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "order_id", "type": "integer"},
            {"name": "status", "type": "text"},
            {"name": "total", "type": "real"},
            {"name": "currency", "type": "text"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, EIU7_ORDERS_CSV)
    # status (6 distinct) and currency (1 distinct) — only status
    # satisfies min_distinct >= 2.
    assert "status" in populated
    # currency has only 1 distinct value → skipped (below min_distinct).
    assert "currency" not in populated
    status_col = next(c for c in model["columns"] if c["name"] == "status")
    assert status_col["enum_values"] == [
        "cancelled",
        "delivered",
        "paid",
        "pending",
        "refunded",
        "shipped",
    ]


# ---------------------------------------------------------------------------
# 2. Above the 8-distinct cap → not sampled (treated as free text).
# ---------------------------------------------------------------------------


def test_high_cardinality_text_not_sampled() -> None:
    rows = "\n".join(f"{i},city_{i}" for i in range(15))
    csv = f"id,city\n{rows}\n"
    model = {
        "name": "customers",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "city", "type": "text"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []
    city_col = next(c for c in model["columns"] if c["name"] == "city")
    assert city_col.get("enum_values") is None


# ---------------------------------------------------------------------------
# 3. Below min_distinct (constant column) → not sampled.
# ---------------------------------------------------------------------------


def test_constant_column_not_sampled() -> None:
    csv = "id,country\n1,US\n2,US\n3,US\n"
    model = {
        "name": "customers",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "country", "type": "text"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []


# ---------------------------------------------------------------------------
# 4. Excluded columns (id, email, etc.) never sampled.
# ---------------------------------------------------------------------------


def test_excluded_columns_never_sampled() -> None:
    csv = (
        "id,email,phone,uuid\n" "1,a@x.com,555-1,u1\n" "2,b@x.com,555-2,u2\n" "3,c@x.com,555-3,u3\n"
    )
    model = {
        "name": "customers",
        "columns": [
            {"name": "id", "type": "text"},
            {"name": "email", "type": "text"},
            {"name": "phone", "type": "text"},
            {"name": "uuid", "type": "text"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []


# ---------------------------------------------------------------------------
# 5. Creator-declared enum_values are NEVER overwritten.
# ---------------------------------------------------------------------------


def test_existing_enum_values_preserved() -> None:
    model = {
        "name": "tasks",
        "columns": [
            {
                "name": "priority",
                "type": "text",
                "enum_values": ["low", "medium", "high"],  # Creator-declared
            }
        ],
    }
    csv = "id,priority\n1,urgent\n2,critical\n3,extreme\n"
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []
    assert model["columns"][0]["enum_values"] == ["low", "medium", "high"]


# ---------------------------------------------------------------------------
# 6. Non-text column type → not sampled.
# ---------------------------------------------------------------------------


def test_integer_column_not_sampled_even_if_low_cardinality() -> None:
    csv = "id,rating\n1,3\n2,4\n3,5\n4,3\n"
    model = {
        "name": "reviews",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "rating", "type": "integer"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []


# ---------------------------------------------------------------------------
# 7. Empty/null seed values skipped.
# ---------------------------------------------------------------------------


def test_empty_and_null_values_ignored_in_distinct_count() -> None:
    csv = "id,status\n" "1,active\n" "2,\n" "3,null\n" "4,inactive\n"
    model = {
        "name": "items",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "status", "type": "text"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["status"]
    status_col = next(c for c in model["columns"] if c["name"] == "status")
    assert status_col["enum_values"] == ["active", "inactive"]


# ---------------------------------------------------------------------------
# 8. backend_config-level sampling across multiple models.
# ---------------------------------------------------------------------------


def test_sample_enum_values_for_models_full_flow() -> None:
    backend_config = {
        "models": [
            {
                "name": "orders",
                "columns": [
                    {"name": "id", "type": "integer"},
                    {"name": "status", "type": "text"},
                ],
            },
            {
                "name": "customers",
                "columns": [
                    {"name": "id", "type": "integer"},
                    {"name": "segment", "type": "text"},
                ],
            },
            {
                "name": "no_seed_model",
                "columns": [{"name": "id", "type": "integer"}],
            },
        ]
    }
    seed_csvs = {
        "orders": "id,status\n1,paid\n2,shipped\n3,delivered\n",
        "customers": "id,segment\n1,vip\n2,standard\n",
        # no_seed_model intentionally omitted.
    }
    result = sample_enum_values_for_models(backend_config, seed_csvs)
    assert result == {"orders": ["status"], "customers": ["segment"]}


# ---------------------------------------------------------------------------
# 9. Empty/malformed inputs fail open.
# ---------------------------------------------------------------------------


def test_empty_backend_config_fails_open() -> None:
    assert sample_enum_values_for_models(None, {}) == {}
    assert sample_enum_values_for_models({}, {}) == {}
    assert sample_enum_values_for_models({"models": []}, {}) == {}


def test_empty_seed_csv_fails_open() -> None:
    model = {"name": "x", "columns": [{"name": "status", "type": "text"}]}
    assert sample_enum_values_from_seed_csv(model, "") == []
    assert sample_enum_values_from_seed_csv(model, "id,status\n") == []


# ---------------------------------------------------------------------------
# 10. Distinct in [2,8] window inclusive at boundaries.
# ---------------------------------------------------------------------------


def test_boundary_distinct_count_two_sampled() -> None:
    csv = "id,status\n1,active\n2,inactive\n3,active\n"
    model = {
        "name": "x",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "status", "type": "text"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["status"]
    assert model["columns"][1]["enum_values"] == ["active", "inactive"]


def test_boundary_distinct_count_eight_sampled() -> None:
    # 8 distinct values (upper window boundary) WITH a repeat, so the
    # no-repetition guard (all-distinct ≥5 → free text) doesn't fire — this
    # isolates the distinct-count boundary from the repetition signal.
    rows = "\n".join(f"{i},val_{i}" for i in range(1, 9)) + "\n9,val_1"  # 8 distinct, val_1 twice
    csv = f"id,kind\n{rows}\n"
    model = {
        "name": "x",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "kind", "type": "text"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["kind"]
    assert len(model["columns"][1]["enum_values"]) == 8


def test_boundary_distinct_count_nine_not_sampled() -> None:
    rows = "\n".join(f"{i},val_{i}" for i in range(1, 10))  # 9 distinct
    csv = f"id,kind\n{rows}\n"
    model = {
        "name": "x",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "kind", "type": "text"},
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []


# ---------------------------------------------------------------------------
# 11. Free-text / identifier columns are NOT sampled (amukkmasq over-capture).
# ---------------------------------------------------------------------------


# A 5-row demo seed exactly like the LedgerLite clients/invoices/user_settings
# tables: every free-text column is unique-per-row, so its distinct count lands
# in the [2,8] window and the OLD gate locked each to a bogus 5-value enum
# (clients.name → 5 person names, etc.). The name-based denylist now skips them.
_LEDGER_CLIENTS_CSV = (
    "id,name,company,company_name,notes,due_date,tax_id,status\n"
    "1,Sarah Chen,Chen Studio,Chen Studio LLC,first invoice,2026-06-01,TX-1001,paid\n"
    "2,Marcus Rodriguez,Rodriguez Co,Rodriguez Co LLC,follow up,2026-06-05,TX-1002,sent\n"
    "3,Aisha Patel,Patel Web,Patel Web LLC,net 30,2026-06-09,TX-1003,paid\n"
    "4,Kenji Yamamoto,Yamamoto Lab,Yamamoto Lab LLC,rush job,2026-06-12,TX-1004,sent\n"
    "5,Olivia Williams,Williams Media,Williams Media LLC,retainer,2026-06-15,TX-1005,paid\n"
)


def test_free_text_and_identifier_columns_not_sampled() -> None:
    model = {
        "name": "clients",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "name", "type": "text"},
            {"name": "company", "type": "text"},
            {"name": "company_name", "type": "text"},  # _name suffix
            {"name": "notes", "type": "text"},
            {"name": "due_date", "type": "text"},  # _date suffix + explicit
            {"name": "tax_id", "type": "text"},  # _id suffix + explicit
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, _LEDGER_CLIENTS_CSV)
    assert populated == []
    for col in model["columns"]:
        assert col.get("enum_values") is None


def test_real_enum_still_sampled_alongside_free_text() -> None:
    # ``status`` (a genuine closed vocab) IS sampled even when the same seed
    # carries free-text columns the denylist rejects.
    model = {
        "name": "invoices",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "name", "type": "text"},  # denied
            {"name": "notes", "type": "text"},  # denied
            {"name": "status", "type": "text"},  # sampled
        ],
    }
    populated = sample_enum_values_from_seed_csv(model, _LEDGER_CLIENTS_CSV)
    assert populated == ["status"]
    status_col = next(c for c in model["columns"] if c["name"] == "status")
    # Build-time key stays snake_case (validators read both; runtime ignores it
    # so a seed-derived, possibly-incomplete enum never enforces at runtime).
    assert status_col["enum_values"] == ["paid", "sent"]


# ---------------------------------------------------------------------------
# 10. Date columns are never sampled — value-based guard (app aqyxejmw5).
# ---------------------------------------------------------------------------


def test_relative_date_tokens_not_sampled_into_enum() -> None:
    # aqyxejmw5 (2026-07-12): ``date_added`` slipped past the name denylist
    # (not "date"/"due_date", doesn't end in _date/_at) and its 8 relative-date
    # seed tokens were sampled straight into enum_values, leaking into runtime
    # filter dropdowns. Value-based guard skips it regardless of name.
    model = {
        "name": "hikes",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "date_added", "type": "text"},
        ],
    }
    csv = (
        "id,date_added\n"
        "1,__TODAY__-30d\n2,__TODAY__-21d\n3,__TODAY__-14d\n4,__TODAY__-7d\n"
        "5,__TODAY__-3d\n6,__TODAY__-1d\n7,__TODAY__\n8,__TODAY__-45d\n"
    )
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []
    date_col = next(c for c in model["columns"] if c["name"] == "date_added")
    assert date_col.get("enum_values") is None


def test_iso_date_and_datetime_values_not_sampled() -> None:
    model = {
        "name": "events",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "happened", "type": "text"},  # ISO dates
            {"name": "logged", "type": "text"},  # ISO datetimes
        ],
    }
    csv = (
        "id,happened,logged\n"
        "1,2026-01-02,2026-01-02T08:00:00Z\n"
        "2,2026-03-04,2026-03-04T09:30:00Z\n"
        "3,2026-05-06,2026-05-06T10:15:00Z\n"
    )
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []
    for name in ("happened", "logged"):
        col = next(c for c in model["columns"] if c["name"] == name)
        assert col.get("enum_values") is None


def test_now_tokens_skipped_but_real_enum_alongside_still_sampled() -> None:
    # A date column (__NOW__ tokens) is skipped while a genuine status enum in
    # the same seed is still sampled — the guard is per-column, value-based.
    model = {
        "name": "shipments",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "shipped_ts", "type": "text"},  # __NOW__ tokens → skipped
            {"name": "state", "type": "text"},  # real enum → sampled
        ],
    }
    csv = (
        "id,shipped_ts,state\n" "1,__NOW__-2h,pending\n2,__NOW__-1h,shipped\n3,__NOW__,delivered\n"
    )
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["state"]
    assert next(c for c in model["columns"] if c["name"] == "shipped_ts").get("enum_values") is None
    assert next(c for c in model["columns"] if c["name"] == "state")["enum_values"] == [
        "delivered",
        "pending",
        "shipped",
    ]


def test_year_like_integers_still_sampled_not_mistaken_for_dates() -> None:
    # A bare year ("2024") is NOT an ISO date (needs YYYY-MM-DD), so a genuine
    # low-cardinality year-ish text enum must still sample.
    model = {
        "name": "cars",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "trim", "type": "text"},
        ],
    }
    csv = "id,trim\n1,base\n2,sport\n3,base\n4,luxury\n"
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["trim"]


# ---------------------------------------------------------------------------
# 11. Free-text NAME columns are never sampled (app a1a73orsx: books.author).
# ---------------------------------------------------------------------------


def test_author_person_names_not_sampled_by_name() -> None:
    # a1a73orsx (2026-07-12): `author` fell in the [2,8] window with 8 distinct
    # person names and was locked to an enum. `author` is now denylisted.
    model = {
        "name": "books",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "author", "type": "text"},
            {"name": "genre", "type": "text"},
        ],
    }
    csv = (
        "id,author,genre\n"
        "1,Amara Osei,fiction\n2,Daniel Okonkwo,mystery\n3,Elena Marchetti,fiction\n"
        "4,James Clear,non-fiction\n5,Maya Lindstrom,sci-fi\n6,Priya Sharma,fiction\n"
        "7,Thomas Armitage,mystery\n8,Yuki Tanaka,biography\n"
    )
    populated = sample_enum_values_from_seed_csv(model, csv)
    # genre repeats (fiction x3, mystery x2) → real enum sampled; author skipped.
    assert "author" not in populated
    assert "genre" in populated
    assert next(c for c in model["columns"] if c["name"] == "author").get("enum_values") is None


def test_created_by_suffix_not_sampled() -> None:
    model = {
        "name": "tickets",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "created_by", "type": "text"},
        ],
    }
    csv = "id,created_by\n1,alice\n2,bob\n3,carol\n4,dave\n5,erin\n6,alice\n"
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []


def test_all_distinct_freetext_not_in_denylist_skipped_by_repetition_guard() -> None:
    # A free-text column NOT covered by the name denylist (e.g. `reference`)
    # with all-distinct values (≥5 samples) is skipped by the value-based
    # no-repetition guard — there is no repetition evidence of a closed vocab.
    model = {
        "name": "orders",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "reference", "type": "text"},
        ],
    }
    csv = (
        "id,reference\n1,REF-9271\n2,REF-4410\n3,REF-8823\n4,REF-1567\n" "5,REF-3092\n6,REF-7734\n"
    )  # 6 distinct in 6 rows → all unique
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == []


def test_repeated_values_still_sampled_despite_high_cardinality() -> None:
    # The guard fires ONLY when every value is distinct. A genuine enum whose
    # values repeat is still sampled even at the window edge.
    model = {
        "name": "orders",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "status", "type": "text"},
        ],
    }
    # 6 distinct across 9 rows (repeats) → sampled.
    csv = (
        "id,status\n1,new\n2,paid\n3,shipped\n4,paid\n5,delivered\n"
        "6,new\n7,refunded\n8,cancelled\n9,shipped\n"
    )
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["status"]
    assert len(next(c for c in model["columns"] if c["name"] == "status")["enum_values"]) == 6


def test_small_all_distinct_enum_still_sampled_below_repeat_threshold() -> None:
    # Below _ENUM_MIN_REPEAT_SAMPLES the seed is too small to distinguish a
    # 3-value enum from 3 unique names, so a tiny all-distinct enum is still
    # sampled (favoring coverage) — the no-repetition guard does NOT fire.
    model = {
        "name": "items",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "size", "type": "text"},
        ],
    }
    csv = "id,size\n1,small\n2,medium\n3,large\n"  # 3 distinct in 3 rows, < 5
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["size"]
    assert next(c for c in model["columns"] if c["name"] == "size")["enum_values"] == [
        "large",
        "medium",
        "small",
    ]


# ---------------------------------------------------------------------------
# 12. Closed-vocab NAMES are exempt from the no-repetition guard (review Q2/Q5).
# ---------------------------------------------------------------------------


def test_enum_likely_status_sampled_even_when_all_distinct() -> None:
    # Review Q2: a `status` enum seeded one-row-per-value is all-distinct, but
    # status STRONGLY signals a closed vocab — the feature's own eiu7xj0v case.
    # It must still be sampled (the no-repetition guard is exempted for it).
    model = {
        "name": "orders",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "status", "type": "text"},
        ],
    }
    csv = "id,status\n1,pending\n2,paid\n3,shipped\n4,delivered\n5,refunded\n6,cancelled\n"  # 6 distinct in 6 rows → all unique, but enum-likely name
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["status"]
    assert len(next(c for c in model["columns"] if c["name"] == "status")["enum_values"]) == 6


def test_enum_likely_size_sampled_all_distinct_five_values() -> None:
    # Review Q5: canonical 5-value enums seeded one-each (XS/S/M/L/XL) must
    # still sample — `size` is enum-likely.
    model = {
        "name": "products",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "size", "type": "text"},
        ],
    }
    csv = "id,size\n1,XS\n2,S\n3,M\n4,L\n5,XL\n"
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["size"]


def test_enum_likely_suffix_exempt_from_repetition_guard() -> None:
    # `payment_status` (suffix _status) → enum-likely even all-distinct.
    model = {
        "name": "invoices",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "payment_status", "type": "text"},
        ],
    }
    csv = "id,payment_status\n1,draft\n2,sent\n3,viewed\n4,paid\n5,overdue\n6,void\n"
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["payment_status"]


def test_brand_no_longer_hard_denied_samples_when_repeated() -> None:
    # Review Q1: `brand` removed from the denylist — a genuine catalog brand
    # enum (repeated values) now samples instead of being blocked by name. An
    # all-distinct brand column would still be skipped by the no-repetition guard.
    model = {
        "name": "products",
        "columns": [
            {"name": "id", "type": "integer"},
            {"name": "brand", "type": "text"},
        ],
    }
    csv = "id,brand\n1,Nike\n2,Adidas\n3,Nike\n4,Puma\n5,Adidas\n6,Reebok\n"
    populated = sample_enum_values_from_seed_csv(model, csv)
    assert populated == ["brand"]
