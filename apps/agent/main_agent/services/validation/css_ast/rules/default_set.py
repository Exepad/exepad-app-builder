"""theme.css rule-set factory.

``theme_css_rules`` returns a fresh instance list per call. Order is
irrelevant — ``run_rules`` sorts findings by ``(severity, line, col)``.
"""

from __future__ import annotations

from .base import CssRule
from .contrast import M3ContrastPairsRule, SdkContrastPairsRule
from .forbidden import (
    BootstrapInsideLayerRule,
    FontFaceRule,
    GlobalResetRule,
    HostSelectorRule,
    V3TailwindBaseRule,
)
from .hsl_format import HslFnWrapperRule, HslHexInsteadRule
from .required import (
    LayerExepadAppRule,
    RootBlockRule,
    SdkVariablesRule,
    TailwindImportRule,
)


def theme_css_rules() -> list[CssRule]:
    """Full theme.css rule set — 13 rules."""
    return [
        # Forbidden patterns
        HostSelectorRule(),
        V3TailwindBaseRule(),
        GlobalResetRule(),
        FontFaceRule(),
        BootstrapInsideLayerRule(),
        # Required structure
        LayerExepadAppRule(),
        TailwindImportRule(),
        RootBlockRule(),
        SdkVariablesRule(),
        # HSL format warnings
        HslHexInsteadRule(),
        HslFnWrapperRule(),
        # Contrast advisories
        M3ContrastPairsRule(),
        SdkContrastPairsRule(),
    ]
