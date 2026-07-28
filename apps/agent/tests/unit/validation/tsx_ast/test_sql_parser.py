"""Unit tests for ``tsx_ast.sql`` — the sqlparse wrapper.

Covers the verb/table extraction layer in isolation. These tests run
against ``parse_sql`` directly without any TSX parsing so failures point
squarely at SQL tokenisation bugs.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.sql import SqlRef, parse_sql


class TestTableExtraction:
    def test_basic_select_from(self):
        a = parse_sql("SELECT * FROM guests")
        assert a.tables() == {"guests"}
        assert SqlRef("FROM", "guests") in a.refs

    def test_select_with_alias(self):
        a = parse_sql("SELECT g.name FROM guests g")
        assert a.tables() == {"guests"}

    def test_left_join_reserved_word_table(self):
        """Regression for the events-is-a-keyword bug — sqlparse classifies
        ``events`` as a Keyword token because the name collides with a SQL
        reserved word. The extractor must still capture it via the plain
        Token path."""
        a = parse_sql("SELECT * FROM guests LEFT JOIN events ON events.id = guests.event_id")
        assert a.tables() == {"guests", "events"}

    def test_inner_join(self):
        a = parse_sql("SELECT * FROM guests INNER JOIN events ON events.id = guests.event_id")
        assert a.tables() == {"guests", "events"}

    def test_insert_into_reserved_word_table(self):
        a = parse_sql("INSERT INTO events (name, date) VALUES (?, ?)")
        assert a.tables() == {"events"}
        assert any(r.verb == "INSERT" for r in a.refs)

    def test_update(self):
        a = parse_sql("UPDATE guests SET rsvp = ? WHERE id = ?")
        assert a.tables() == {"guests"}
        assert any(r.verb == "UPDATE" for r in a.refs)

    def test_delete_from(self):
        a = parse_sql("DELETE FROM tasks WHERE completed = 1")
        assert a.tables() == {"tasks"}

    def test_quoted_identifier(self):
        a = parse_sql('SELECT * FROM "events" WHERE 1')
        assert a.tables() == {"events"}

    def test_schema_prefix_stripped(self):
        a = parse_sql("SELECT * FROM main.events")
        assert a.tables() == {"events"}

    def test_empty_string(self):
        assert parse_sql("").refs == []

    def test_non_sql(self):
        # sqlparse is lenient — random text tokenises to nothing useful.
        assert parse_sql("not sql at all").refs == []

    def test_multi_table_join_chain(self):
        a = parse_sql(
            "SELECT * FROM guests g "
            "JOIN events e ON e.id = g.event_id "
            "JOIN vendors v ON v.event_id = e.id"
        )
        assert a.tables() == {"guests", "events", "vendors"}
