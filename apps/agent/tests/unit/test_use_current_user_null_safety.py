"""Unit tests for ``UseCurrentUserNullableFieldChainRule`` — chained
access on a nullable ``useCurrentUser()`` field needs ``?.``.

Bug class motivation: eiu7xj0v (2026-05-14). ``EmployeesContent.tsx`` did
``const user = useCurrentUser(); const isAdmin = user.roles.includes("admin")``
and elsewhere ``user.name.charAt(0)``. The first is safe (roles defaults
to ``[]``) but the second crashes on anonymous users (``name`` typed
nullable in the SDK's ``CurrentUser`` interface).
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_hook_null_safety import (
    UseCurrentUserNullableFieldChainRule,
)


def _ctx(component_tsx: str) -> AstContext:
    return AstContext(
        tsx=component_tsx,
        source_buf=source_bytes(component_tsx),
        tree=parse_tsx(component_tsx),
    )


def _findings(component_tsx: str) -> list:
    return list(UseCurrentUserNullableFieldChainRule().check(_ctx(component_tsx)))


# 1. The eiu7xj0v regression: user.name.charAt(0).


def test_chained_call_on_nullable_field_flagged() -> None:
    tsx = """
import { React, useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  return <span>{user.name.charAt(0)}</span>;
}
"""
    findings = _findings(tsx)
    assert len(findings) == 1
    assert "user.name" in findings[0].message
    assert findings[0].severity == "warning"


# 2. Chained access on email.


def test_chained_call_on_email_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  const local = user.email.toLowerCase();
  return null;
}
"""
    assert len(_findings(tsx)) == 1


# 3. Chained access on id.


def test_chained_call_on_id_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const u = useCurrentUser();
  const upper = u.id.toUpperCase();
  return null;
}
"""
    assert len(_findings(tsx)) == 1


# 4. Optional chain on the nullable field is safe.


def test_optional_chained_access_not_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  return <span>{user.name?.charAt(0)}</span>;
}
"""
    assert _findings(tsx) == []


# 5. ``roles`` and ``isAuthenticated`` are never null — never flag.


def test_roles_includes_call_not_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  const isAdmin = user.roles.includes("admin");
  return null;
}
"""
    assert _findings(tsx) == []


def test_is_authenticated_chained_not_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  const v = user.isAuthenticated.valueOf();
  return null;
}
"""
    assert _findings(tsx) == []


# 6. Bare field reads in JSX don't crash (null interpolates fine).


def test_bare_field_read_in_jsx_not_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  return <span>{user.email}</span>;
}
"""
    assert _findings(tsx) == []


# 7. Aliased binding (`const u = useCurrentUser()`).


def test_aliased_binding_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const u = useCurrentUser();
  return <span>{u.name.toUpperCase()}</span>;
}
"""
    assert len(_findings(tsx)) == 1


# 8. Fail-open: no useCurrentUser binding.


def test_no_use_current_user_call_no_findings() -> None:
    tsx = """
import { useModel } from "@exepad/sdk";
function X() {
  const { data: user } = useModel("users");
  return <span>{user?.[0]?.name?.charAt(0)}</span>;
}
"""
    assert _findings(tsx) == []


# 9. Multiple violations, deduplicated by (line, col, field).


def test_multiple_distinct_violations_each_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  const a = user.id.toUpperCase();
  const b = user.email.toLowerCase();
  const c = user.name.charAt(0);
  return <span>{a}{b}{c}</span>;
}
"""
    findings = _findings(tsx)
    assert len(findings) == 3
    fields = {(f.line, "id" in f.message, "email" in f.message, "name" in f.message)
              for f in findings}
    # Three distinct lines, one finding each.
    assert len(fields) == 3


# 10. Subscript access on nullable field (user.id[0]).


def test_subscript_on_nullable_field_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  return <span>{user.id[0]}</span>;
}
"""
    assert len(_findings(tsx)) == 1


# 11. The OUTER chain link is what matters, not the inner one.
# ``user?.id.X`` is unsafe (id is the nullable field; ``?.`` on ``user``
# is redundant since useCurrentUser never returns null, and it doesn't
# protect ``.X`` from a null ``id``). Must flag.


def test_inner_optional_outer_strict_chain_still_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  return <span>{user?.name.charAt(0)}</span>;
}
"""
    findings = _findings(tsx)
    assert len(findings) == 1, (
        "user?.name.charAt(0) — inner optional protects against null user, "
        "but `name` is the nullable field. The dot before charAt is strict; "
        "rule must flag."
    )


# 12. Symmetric: ``user?.id?.X`` is fully safe — both links optional.


def test_both_links_optional_not_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  return <span>{user?.email?.toLowerCase()}</span>;
}
"""
    assert _findings(tsx) == []


# 13. Optional call on the nullable field: ``user.name?.()`` is safe.
# Not idiomatic for these fields (they're strings, not functions), but
# the rule must respect the grammar's optional-call form.


def test_optional_call_on_nullable_field_not_flagged() -> None:
    tsx = """
import { useCurrentUser } from "@exepad/sdk";
function X() {
  const user = useCurrentUser();
  const v = user.name?.toString();
  return <span>{v}</span>;
}
"""
    assert _findings(tsx) == []
