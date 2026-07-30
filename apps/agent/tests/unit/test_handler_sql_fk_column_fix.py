"""FK-column drift auto-fix for handler SQL.

Reproduces the Orbit (2026-07-10) defect: a handler JOINs on ``t.project`` /
``t.assignee`` (the plan's bare relation names) while the model materialized
``project_id`` / ``assignee_id`` FK columns — failing at runtime with
``no such column: t.project``. The fixer must rewrite the qualified refs to the
real FK columns, and must NOT touch declared columns or non-FK names.
"""

from __future__ import annotations

from main_agent.services.validation.fixers import apply_handler_fk_column_fixes

TASKS_MODELS = [
    {"name": "projects", "columns": [{"name": "name"}]},
    {"name": "members", "columns": [{"name": "name"}]},
    {
        "name": "tasks",
        "columns": [
            {"name": "title"},
            {"name": "status"},
            {"name": "project_id", "references": {"model": "projects", "column": "id"}},
            {"name": "assignee_id", "references": {"model": "members", "column": "id"}},
        ],
    },
]


def _handler(sql: str) -> str:
    return (
        "import { HandlerContext } from '@exepad/sdk';\n"
        "async function handler(ctx: HandlerContext) {\n"
        f"  return await ctx.db.prepare(`{sql}`).all();\n"
        "}\n"
        "export default handler;\n"
    )


def test_rewrites_drifted_join_fk_refs():
    sql = (
        "SELECT t.id, t.title, p.name AS project_name, m.name AS assignee_name "
        "FROM tasks t "
        "LEFT JOIN projects p ON t.project = p.id "
        "LEFT JOIN members m ON t.assignee = m.id "
        "WHERE t.status != 'done'"
    )
    fixed, fixes = apply_handler_fk_column_fixes(_handler(sql), TASKS_MODELS)
    # Drifted refs rewritten to the real FK columns.
    assert "t.project_id = p.id" in fixed
    assert "t.assignee_id = m.id" in fixed
    # The bare (wrong) forms are gone.
    assert "t.project =" not in fixed
    assert "t.assignee =" not in fixed
    assert len(fixes) == 2


def test_leaves_declared_columns_and_joined_parent_columns_alone():
    # p.name / m.name are real columns on the parent; t.status is a real column;
    # p.id / m.id are system columns — none may be rewritten.
    sql = (
        "SELECT p.name, m.name, t.status FROM tasks t "
        "LEFT JOIN projects p ON t.project_id = p.id "
        "LEFT JOIN members m ON t.assignee_id = m.id"
    )
    fixed, fixes = apply_handler_fk_column_fixes(_handler(sql), TASKS_MODELS)
    assert fixes == []
    assert fixed == _handler(sql)  # byte-identical — nothing touched


def test_does_not_touch_string_literals_that_look_like_refs():
    # A literal 't.project' inside the SQL must not be rewritten.
    sql = "SELECT t.title FROM tasks t WHERE t.title = 't.project'"
    fixed, fixes = apply_handler_fk_column_fixes(_handler(sql), TASKS_MODELS)
    assert fixes == []
    assert "'t.project'" in fixed  # the literal is preserved verbatim


def test_no_op_without_relational_models():
    sql = "SELECT id, name FROM contacts c WHERE c.status = 'active'"
    models = [{"name": "contacts", "columns": [{"name": "name"}, {"name": "status"}]}]
    fixed, fixes = apply_handler_fk_column_fixes(_handler(sql), models)
    assert fixes == []
    assert fixed == _handler(sql)


def test_only_renames_when_id_column_is_a_real_fk():
    # `t.category` — there is no `category_id` FK column, so it must be left for
    # the validator/runtime, not invented.
    sql = "SELECT t.title FROM tasks t WHERE t.category = 'x'"
    fixed, fixes = apply_handler_fk_column_fixes(_handler(sql), TASKS_MODELS)
    assert fixes == []
    assert "t.category" in fixed
