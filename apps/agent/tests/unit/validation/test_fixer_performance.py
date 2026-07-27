"""Performance & scale tests for the auto-fix dispatcher.

These tests guard against accidental quadratic / exponential regressions
in any of the regex-based fixers. The full dispatcher must process
realistic large TSX (~1000 lines) inside a few seconds, and every
individual fixer must terminate under 1 second. They also pin the
absence of catastrophic regex backtracking on pathological inputs.

We deliberately use a generous timeout (5s for the dispatcher, 1s per
fixer on a 1000-line input) so the tests stay green on slow CI hosts
while still catching pathological complexity blowups.
"""

from __future__ import annotations

import time

import pytest

from main_agent.services.validation.fixers import apply_auto_fixes
from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_a11y_ux import (
    apply_component_a11y_ux_fixes,
)
from main_agent.services.validation.fixers.component_imports import (
    apply_component_imports_fixes,
)
from main_agent.services.validation.fixers.component_null_safety import (
    apply_component_null_safety_fixes,
)
from main_agent.services.validation.fixers.component_polishing import (
    apply_component_polishing_fixes,
)
from main_agent.services.validation.fixers.component_typos import (
    apply_component_typos_fixes,
)
from main_agent.services.validation.fixers.component_urls_images import (
    apply_component_urls_images_fixes,
)

pytestmark = [pytest.mark.unit]


_SECTION_TEMPLATE = """\
      <section className="bg-surface text-on-surface p-8" data-row="{i}">
        <h2 className="text-2xl">Section {i}</h2>
        <p className="text-on-surface-variant">Some descriptive copy for row {i}.</p>
        <ul className="grid grid-cols-3 gap-4">
          <li><Card>Item A {i}</Card></li>
          <li><Card>Item B {i}</Card></li>
          <li><Card>Item C {i}</Card></li>
        </ul>
        <button onClick={{() => onClick({i})}}>Action {i}</button>
      </section>
"""


def _build_large_tsx(section_count: int = 100) -> str:
    sections = "".join(_SECTION_TEMPLATE.format(i=i) for i in range(section_count))
    return (
        "import { React, Card } from '@exepad/sdk';\n\n"
        "export default function ManySections({ onClick }: { onClick: (i: number) => void }) {\n"
        "  return (\n    <main>\n"
        f"{sections}"
        "    </main>\n  );\n}\n"
    )


def _build_pathological_classname(count: int = 200) -> str:
    """Long className with repeated hover:bg-white/N — exercises the
    hover-overlay capping regex. Ten random opacities concatenated.
    """
    cls_parts = " ".join(f"hover:bg-white/{(i % 90) + 5}" for i in range(count))
    return (
        f"export default function Stress() {{\n"
        f'  return <div className="{cls_parts}" />;\n'
        f"}}\n"
    )


def _build_deeply_nested_jsx(depth: int = 80) -> str:
    """Deeply nested JSX with no fix triggers — pure parser stress."""
    open_tags = "".join("<div>" for _ in range(depth))
    close_tags = "".join("</div>" for _ in range(depth))
    return "export default function Deep() {\n" f"  return ({open_tags}leaf{close_tags});\n" "}\n"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_dispatcher_processes_1000_line_tsx_under_five_seconds():
    """A 100-section TSX (~1000 lines) must process in well under 5s. The
    dispatcher runs every fixer in sequence; this is the primary
    end-to-end performance pin.
    """
    src = _build_large_tsx(section_count=100)
    assert src.count("\n") > 800  # sanity: actually ~1000 lines

    start = time.perf_counter()
    fixed, _ = apply_auto_fixes(
        src,
        models=[],
        actions={},
        state_keys={},
        page_slugs=["/"],
    )
    elapsed = time.perf_counter() - start

    assert elapsed < 5.0, f"dispatcher took {elapsed:.2f}s on ~1000-line input"
    assert isinstance(fixed, str)


_PERF_FIXERS = [
    apply_component_imports_fixes,
    apply_component_urls_images_fixes,
    apply_component_null_safety_fixes,
    apply_component_typos_fixes,
    apply_component_a11y_ux_fixes,
    apply_component_polishing_fixes,
]


@pytest.mark.parametrize("fixer", _PERF_FIXERS, ids=lambda f: f.__name__)
def test_individual_fixer_under_one_second_on_large_input(fixer):
    """Each fixer in isolation must finish under 1s on a 1000-line TSX.
    A regression in any single regex (catastrophic backtracking) shows
    up here.
    """
    src = _build_large_tsx(section_count=100)
    fixes: list[str] = []

    start = time.perf_counter()
    fixer(src, FixContext(state_keys={"profile": None}), fixes)
    elapsed = time.perf_counter() - start

    assert elapsed < 1.0, f"{fixer.__name__} took {elapsed:.2f}s on ~1000-line input"


def test_polishing_fixer_handles_long_classname_without_backtracking():
    """200 hover:bg-white/N classes in a single className is the kind of
    pathological input that catastrophic backtracking would visibly hang on.
    """
    src = _build_pathological_classname(count=200)

    start = time.perf_counter()
    apply_component_polishing_fixes(src, FixContext(), [])
    elapsed = time.perf_counter() - start

    assert elapsed < 1.0, f"polishing took {elapsed:.2f}s on 200 hover classes"


def test_dispatcher_handles_deeply_nested_jsx():
    """80 nested <div> tags must terminate quickly. AST-using fixers must
    not blow the stack.
    """
    src = _build_deeply_nested_jsx(depth=80)

    start = time.perf_counter()
    fixed, _ = apply_auto_fixes(
        src,
        models=[],
        actions={},
        state_keys={},
        page_slugs=["/"],
    )
    elapsed = time.perf_counter() - start

    assert elapsed < 2.0, f"dispatcher took {elapsed:.2f}s on 80-deep JSX"
    assert "<div>" in fixed
    assert "</div>" in fixed
