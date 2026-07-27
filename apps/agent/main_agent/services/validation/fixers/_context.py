"""Shared context passed between the per-category fixer modules.

The dispatcher in ``fixers.dispatcher`` builds one ``FixContext`` per
``apply_auto_fixes`` call and hands it to every category's
``apply_<category>_fixes`` function. The context carries only the slice
of ``apply_auto_fixes``'s parameters that the extracted blocks actually
read — no dict-of-ctx-blobs, no indirection.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class FixContext:
    """Per-call state that category fixers read from.

    Only carries parameters that ``apply_auto_fixes`` forwards into the
    inline fix bodies. ``actions`` is explicitly excluded because the
    dispatcher accepts it for signature stability but no fix block reads
    it.
    """

    expected_component_name: str = ""
    models: list[dict] = field(default_factory=list)
    handlers: list[dict] | None = None
    state_keys: dict = field(default_factory=dict)
    page_slugs: list[str] | None = None
    theme_palette: dict[str, str] | None = None
    # The strip-vs-keep decision for hallucinated LLM image URLs. When False the
    # URL fixer KEEPS valid http(s) image URLs instead of rewriting them to
    # __PLACEHOLDER__ (nothing could re-source the placeholder, so the strip
    # would only ever yield a gray box). Call sites compute it via
    # ``image_generation_utils.should_strip_llm_image_urls()`` — True when a
    # keyed stock provider is configured OR the operator disabled LLM-suggested
    # image URLs (Settings → Stock images). The name is historical; it now means
    # "strip hallucinated LLM URLs". Defaults True so existing fixture goldens,
    # which assert stripping, stay green.
    stock_provider_configured: bool = True
    # True when the app requires authentication (top-level
    # ``app_config.security`` present with ``enabled != False``). The
    # ``dead_signout`` fixer reads this to decide whether to INJECT a missing
    # Sign-Out control into a sidebar — an auth-enabled app with no logout
    # affordance strands the user logged in. Defaults False so non-auth apps
    # (and existing goldens) never get an injected button.
    security_enabled: bool = False
