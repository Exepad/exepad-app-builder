"""CSS parsing wrapper.

``tinycss2.parse_stylesheet`` returns a list of top-level nodes —
at-rules (``@import``, ``@layer``, ``@font-face``, …), qualified rules
(``:root { … }``), whitespace, and comments. We parse once per
validation pass and hand that list to the rule set via
``CssContext.stylesheet``.
"""

from __future__ import annotations

from typing import Any

import tinycss2


def parse_css(source: str) -> list[Any]:
    """Return the top-level stylesheet node list.

    ``skip_comments=False`` keeps comment nodes in the tree so rules
    that care about context-position can still see them. ``skip_whitespace=False``
    keeps whitespace for the same reason — tinycss2 nodes carry source
    positions we want to preserve unmodified.
    """
    return tinycss2.parse_stylesheet(source, skip_comments=False, skip_whitespace=False)
