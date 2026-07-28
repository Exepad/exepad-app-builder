"""Integration tests for the handler semantic validation orchestrator.

Unit-level coverage of every rule lives in
``tests/unit/validation/tsx_ast/``. This file exercises the two public
entry points in ``handler_semantic_validator`` — ``apply_handler_auto_fixes``
and ``run_handler_semantic_checks`` — end-to-end on realistic handler
TSX snippets to make sure the whole pipeline still produces the right
shape of ``SemanticResult``.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers import apply_handler_auto_fixes
from main_agent.services.validation.handler_semantic_validator import (
    run_handler_semantic_checks,
)

pytestmark = [pytest.mark.unit]


class TestApplyHandlerAutoFixes:
    def test_react_import_rewrite(self):
        code = 'import { useState } from "react";\nexport default function handler() {}'
        fixed, fixes = apply_handler_auto_fixes(code)
        assert "@exepad/sdk" in fixed
        assert "react" not in fixed.split("@exepad")[0]
        assert len(fixes) == 1
        assert "react" in fixes[0].lower()

    def test_framer_motion_rewrite(self):
        code = "import { motion } from 'framer-motion';"
        fixed, fixes = apply_handler_auto_fixes(code)
        assert "'@exepad/sdk'" in fixed
        assert len(fixes) == 1

    def test_lucide_react_rewrite(self):
        code = 'import { Icon } from "lucide-react";'
        fixed, fixes = apply_handler_auto_fixes(code)
        assert '"@exepad/sdk"' in fixed
        assert len(fixes) == 1

    def test_no_fix_needed(self):
        code = 'import { HandlerContext } from "@exepad/sdk";'
        fixed, fixes = apply_handler_auto_fixes(code)
        assert fixed == code
        assert fixes == []

    def test_strips_hallucinated_model_import(self):
        code = (
            'import { tasks } from "tasks";\n'
            'import { HandlerContext } from "@exepad/sdk";\n'
            "export default async function h(ctx) { return {}; }\n"
        )
        fixed, fixes = apply_handler_auto_fixes(code, model_names=["tasks"])
        assert 'from "tasks"' not in fixed
        assert any("Stripped model-name import" in f for f in fixes)


class TestRunHandlerSemanticChecks:
    def test_valid_handler(self):
        code = """
import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await ctx.db.prepare(
        'INSERT INTO tasks (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, ctx.user.id, ctx.params.title, now, now).run();
    return { id, success: true };
}
"""
        result = run_handler_semantic_checks(code)
        assert result.valid
        assert result.errors == []

    def test_sql_injection_detected(self):
        code = """
import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
    await ctx.db.prepare(`SELECT * FROM users WHERE name = '${ctx.params.name}'`).run();
    return {};
}
"""
        result = run_handler_semantic_checks(code)
        assert not result.valid
        assert any("SQL injection" in e for e in result.errors)

    def test_forbidden_import_detected(self):
        code = """
import axios from "axios";

export default async function handler(ctx) {
    const res = await axios.get("https://api.example.com");
    return res.data;
}
"""
        result = run_handler_semantic_checks(code)
        assert not result.valid
        assert any("Forbidden import" in e for e in result.errors)

    def test_missing_export_default(self):
        code = """
import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
    return {};
}
"""
        result = run_handler_semantic_checks(code)
        assert not result.valid
        assert any("export default" in e for e in result.errors)

    def test_browser_api_in_handler(self):
        code = """
import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
    document.title = "Hello";
    return {};
}
"""
        result = run_handler_semantic_checks(code)
        assert not result.valid
        assert any("document" in e for e in result.errors)

    def test_warnings_dont_block(self):
        """Signature warnings don't set result.valid = False."""
        code = """
import { HandlerContext } from "@exepad/sdk";

export default async function handler() {
    return { ok: true };
}
"""
        result = run_handler_semantic_checks(code)
        assert result.valid
        assert len(result.warnings) > 0

    def test_model_references_with_models(self):
        """Passing a models list turns on the SQL table-reference rule."""
        code = """
import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
    await ctx.db.prepare(
        'INSERT INTO user_settings (owner_id) VALUES (?)'
    ).bind(ctx.user.id).run();
    return { ok: true };
}
"""
        result = run_handler_semantic_checks(code, models=[{"name": "orders"}])
        assert not result.valid
        assert any("user_settings" in e for e in result.errors)

    def test_model_references_opt_out_when_none(self):
        """models=None disables the table-reference rule — other rules still run."""
        code = """
import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
    await ctx.db.prepare('SELECT * FROM wild_table').all();
    return { ok: true };
}
"""
        result = run_handler_semantic_checks(code, models=None)
        # No undeclared-table error because the rule is skipped entirely.
        assert not any("wild_table" in e for e in result.errors)

    def test_fail_loudly_throw_blocks(self):
        code = """
import { HandlerContext } from "@exepad/sdk";

export default async function handler(ctx: HandlerContext) {
    throw new Error('handler_plan references undeclared tables: walks, pets');
}
"""
        result = run_handler_semantic_checks(code, models=[{"name": "orders"}])
        assert not result.valid
        assert any("Hard Rule #5 escalation" in e for e in result.errors)
