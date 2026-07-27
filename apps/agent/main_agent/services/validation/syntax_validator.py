"""Stage 1: TSX syntax + (optional) Stage 1.5 TypeScript type check.

Stage 1 (esbuild): transform-only parse, no bundling — pure syntax
check. Fast (< 100 ms per file), standalone binary in the container.

Stage 1.5 (tsc, optional): when ``Node.js`` + ``tsc`` are present in
the runtime environment AND a per-app ``app.d.ts`` is generated for
the workflow, ``run_tsc_check`` runs ``tsc --noEmit`` against the
component, the SDK type bundle, and the per-app declarations.
``tsc.<TS-code>`` findings surface model / handler / icon / state-key
typos at compile time instead of runtime — replacing the catalog of
fragile cross-reference AST rules.

Stage 1 (esbuild) and Stage 1.5 (tsc) fail open in development when
their binaries aren't on ``$PATH`` (local dev without Node.js) — the
rest of the pipeline still runs. **Production fails loud:** if
``ENVIRONMENT=production`` and either binary is missing, the validator
raises :class:`ProductionDependencyMissing` so the misconfigured
container fails its health check rather than serving for hours with
disabled validation. See ``services/validation/_env.py``.
"""

import os
import subprocess
import tempfile

import structlog

from ._env import require_in_production
from .finding import Finding
from .tsc_validator import run_tsc_check

logger = structlog.get_logger(__name__)


def validate_tsx_syntax(tsx_source: str) -> tuple[bool, list[str]]:
    """Stage 1 — esbuild transform-only syntax check.

    Args:
        tsx_source: TSX source code string

    Returns:
        ``(valid, errors)`` — True if syntax is valid, list of error
        messages otherwise.

    Raises:
        ProductionDependencyMissing: When the esbuild binary is missing
            and ``ENVIRONMENT=production``. Dev environments without
            esbuild fail open and return ``(True, [])`` so unrelated
            tests still run; production must have the binary vendored
            via the Dockerfile.
    """
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".tsx", mode="w", delete=False) as f:
            path = f.name
            f.write(tsx_source)
        result = subprocess.run(
            [
                "esbuild",
                path,
                "--bundle=false",
                "--format=esm",
                "--jsx=automatic",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        return False, ["esbuild timed out (>10s)"]
    except FileNotFoundError:
        # Production fails loud: the Dockerfile vendors esbuild, so a
        # missing binary means the container is misconfigured and we
        # MUST NOT silently ship code with an empty syntax check.
        # Dev still fails open so a contributor without esbuild can
        # iterate on the rest of the pipeline.
        require_in_production(
            dependency="esbuild",
            hint=(
                "The Dockerfile vendors esbuild — a missing binary means "
                "the container build is broken. Refusing to validate "
                "components with no syntax check."
            ),
        )
        logger.warning("esbuild binary not found — skipping syntax validation")
        return True, []
    finally:
        if path and os.path.exists(path):
            os.unlink(path)

    if result.returncode == 0:
        return True, []

    errors = [line.strip() for line in result.stderr.split("\n") if "error:" in line.lower()]

    # Fallback: if no structured errors found, include raw output
    if not errors:
        raw = (result.stderr or result.stdout or "").strip()
        if raw:
            errors = [raw[:500]]
        else:
            errors = [f"esbuild exited with code {result.returncode} (no error output)"]

    return False, errors


def validate_tsx_with_tsc(
    *,
    tsx_source: str,
    component_name: str,
    app_dts: str,
    sibling_modules: dict[str, str] | None = None,
) -> list[Finding]:
    """Stage 1.5 — tsc --noEmit type check against per-app declarations.

    Returns a list of :class:`Finding` (severity=error, rule_id=
    ``tsc.<code>``). Empty list when the SDK type bundle can't be
    located or when the component is empty. Subprocess timeouts surface
    as a single ``tsc.timeout`` finding instead of taking down the
    workflow.

    The ``sibling_modules`` map is used by Babel-shell components and
    modules so cross-sibling imports (``./Charts``, ``./Data`` …)
    resolve at the per-file tsc step instead of surfacing as TS2307
    false positives. See :func:`run_tsc_check` for details.

    Raises:
        ProductionDependencyMissing: When the tsc binary is missing and
            ``ENVIRONMENT=production``. Dev environments without tsc
            fail open and return ``[]`` so unrelated tests still run;
            production must have tsc vendored via the Dockerfile.
    """
    return run_tsc_check(
        tsx=tsx_source,
        component_name=component_name,
        app_dts=app_dts,
        sibling_modules=sibling_modules,
    )
