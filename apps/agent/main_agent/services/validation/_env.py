"""Environment detection for production fail-loud guards.

Validators historically fail open when their dependencies are missing —
``validate_tsx_syntax`` returns ``(True, [])`` if esbuild isn't on PATH;
``load_sdk_exports`` returns an empty frozenset if the catalog file is
missing; ``run_tsc_check`` swallows ``FileNotFoundError`` for tsc.

The behavior is correct in dev (a contributor without Node/esbuild can
still run unit tests) but wrong in production: a misconfigured container
silently disables a validation layer and corrupted output ships
unnoticed. The ``ze1ltmf9`` / silent-empty-allow-list incident traced
back to this exact pattern.

In production (``ENVIRONMENT=production``) we want every fail-open path
to fail LOUD instead, so a misconfigured container fails health-check at
startup rather than serving for hours with disabled validation.
"""

from __future__ import annotations

import os


def is_production() -> bool:
    """True when ``ENVIRONMENT=production``.

    The agent's runtime config sets ``ENVIRONMENT`` from
    ``deployment/env_vars.yaml`` (see ``deploy-agent.sh``). Default is
    ``"development"`` so local dev remains permissive.
    """
    return os.getenv("ENVIRONMENT", "development") == "production"


class ProductionDependencyMissing(RuntimeError):
    """A validation dependency that must be present in production isn't.

    Raised at module-import or first-use time so the agent fails its
    health check rather than running with a silently-disabled validator.
    """


def require_in_production(dependency: str, hint: str) -> None:
    """Raise ``ProductionDependencyMissing`` when running in production.

    No-op in development. Used at fail-open sites in the validation
    pipeline to escalate "dependency not found" from a logged warning
    (dev) to a fatal error (prod).

    Args:
        dependency: Short name of the missing dependency (``esbuild``,
            ``tsc``, ``sdk-exports.json``).
        hint: One-line remediation message — usually points at the
            deploy script step or vendor location that should have
            provided the dependency.
    """
    if is_production():
        raise ProductionDependencyMissing(
            f"{dependency} is missing in production. {hint}"
        )
