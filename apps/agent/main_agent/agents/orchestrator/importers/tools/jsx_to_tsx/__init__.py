"""Mechanical JSX → TSX translator for Babel-shell design imports.

Sister module to ``html_to_tsx``. Where ``html_to_tsx`` walks cleaned
HTML and emits a TSX skeleton wrapping the body markup, ``jsx_to_tsx``
takes already-React JSX (the concatenated ``content:<slug>:script.jsx``
artifact emitted by the decomposition runner) and produces a working
``codefocus_component:{Name}.tsx`` by stripping ``ReactDOM`` bootstrap
calls, injecting the SDK import, and wrapping the root component in
``<LightDOMContainer>``.

Public entry: :func:`transform_jsx_to_tsx`.
"""

from __future__ import annotations

from .dispatcher import TranslatedComponent, translate_design_import_components
from .module_transformer import (
    ModuleSpec,
    transform_babel_shell_modules,
    transform_jsx_module,
)
from .transformer import transform_jsx_to_tsx

__all__ = [
    "ModuleSpec",
    "TranslatedComponent",
    "transform_babel_shell_modules",
    "transform_jsx_module",
    "transform_jsx_to_tsx",
    "translate_design_import_components",
]
