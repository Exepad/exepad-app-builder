"""Regression tests for ``extract_chrome_region_with_fallback``.

App ``kngnrssf`` (2026-05-17, Claude Design chick-farm import):
DesignImporter LLM emitted
``ChromeRegion(role='footer', source_artifact='bundle:doc:partials.html',
selector='footer.footer')`` — but the bundle's ``partials.html`` contained
only ``<nav>``; the actual ``<footer class="footer">`` markup lived inlined
in every per-page bundle. The selector itself was correct CSS; the
source_artifact was wrong. The chrome-extract path had no fallback and the
entire workflow aborted at decomposition with no recovery.

The shared helper now:
  1. Tries the LLM's declared ``(source, selector)`` first (happy path).
  2. On miss, tries the declared source with per-role fallback selectors.
  3. On further miss, tries every staged ``bundle:html:*`` page artifact
     with the original selector.
  4. On further miss, tries page artifacts with fallback selectors.
  5. Only raises ``HandlerError`` after every attempt is exhausted.

These tests pin all four layers.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
    CHROME_FALLBACK_SELECTORS,
    HandlerError,
    chrome_fallback_selectors,
    extract_chrome_region_with_fallback,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    ChromeRegion,
)

pytestmark = [pytest.mark.unit]


# ---------------------------------------------------------------------------
# Fixtures — minimal in-memory artifact service stub
# ---------------------------------------------------------------------------


class _StubInlineData:
    def __init__(self, data: bytes):
        self.data = data


class _StubPart:
    def __init__(self, data: bytes):
        self.inline_data = _StubInlineData(data)


class _StubArtifactService:
    """In-memory artifact store backed by a ``dict[filename → bytes]``."""

    def __init__(self, store: dict[str, str]):
        self._store = {k: v.encode("utf-8") for k, v in store.items()}

    async def load_artifact(
        self, *, session_id, user_id, app_name, filename, version=None
    ):
        if filename not in self._store:
            return None
        return _StubPart(self._store[filename])

    async def list_artifact_keys(self, *, session_id, user_id, app_name):
        # Mirrors the ADK artifact-service contract used by
        # ``base._list_page_html_artifacts``.
        return list(self._store.keys())


class _StubSession:
    def __init__(self):
        self.id = "s"
        self.user_id = "u"
        self.app_name = "a"


class _StubCtx:
    def __init__(self, store: dict[str, str]):
        self.session = _StubSession()
        self.artifact_service = _StubArtifactService(store)


# Bundle shape mirroring the real ``kngnrssf`` failure:
#   - partials.html: nav only, NO footer
#   - per-page bundles: identical `<footer class="footer">` inlined
KNGNRSSF_PARTIALS = (
    '<nav class="nav">'
    '<div class="nav-inner"><a class="brand" href="index.html">HappyDoods</a></div>'
    "</nav>"
)

KNGNRSSF_PAGE_HTML = (
    "<html><body>"
    '<header class="page-header"><h1>HappyDoods</h1></header>'
    "<main><p>Page body content.</p></main>"
    '<footer class="footer">'
    '<div class="wrap"><div class="footer-grid">'
    "<div>Eggs from hens who know their names.</div>"
    "</div></div>"
    "</footer>"
    "</body></html>"
)


def _region(role: str, source: str, selector: str) -> ChromeRegion:
    return ChromeRegion(
        role=role,
        output_artifact=f"content:main:{role}.html",
        source_artifact=source,
        selector=selector,
    )


# ---------------------------------------------------------------------------
# Fallback-selector catalogue smoke tests
# ---------------------------------------------------------------------------


def test_header_fallbacks_include_nav_nav() -> None:
    fb = chrome_fallback_selectors("header")
    assert "header" in fb
    assert "nav.nav" in fb


# ---------------------------------------------------------------------------
# Typing fix: _list_page_html_artifacts uses InvocationContext-native path
# ---------------------------------------------------------------------------


class TestListPageHtmlArtifactsTyping:
    """Pre-fix the helper called ``ArtifactManager.list_artifacts(ctx)``
    which invokes ``ctx.list_artifacts()`` — a CallbackContext method.
    The decomposition runner passes ``InvocationContext`` which lacks
    that attribute. The defensive ``except`` masked the bug by returning
    ``[]``, so the chrome-fallback discovery was silently zeroed
    (production app u0j2m40o, 2026-05-19). The fix switches to the
    idiomatic ``ctx.artifact_service.list_artifact_keys(...)`` pattern
    that does work on InvocationContext."""

    async def test_uses_artifact_service_list_artifact_keys(self):
        """Stub context exposes only ``artifact_service.list_artifact_keys``
        (no ``ctx.list_artifacts``). Helper must succeed and filter to
        ``bundle:html:*`` keys."""
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            _list_page_html_artifacts,
        )

        ctx = _StubCtx(
            {
                "bundle:html:home/code.html": "<html/>",
                "bundle:html:about/code.html": "<html/>",
                "bundle:doc:partials.html": "<nav/>",  # non-page key
                "codefocus_component:Foo.tsx": "// not a page key",
                "bundle:asset:styles.css": "/* not a page */",
            }
        )
        keys = await _list_page_html_artifacts(ctx)
        assert keys == [
            "bundle:html:about/code.html",
            "bundle:html:home/code.html",
        ]

    async def test_returns_empty_when_service_raises(self):
        """If ``list_artifact_keys`` raises (transport doesn't support
        listing), the helper returns ``[]`` instead of propagating —
        fail-open so the chrome-fallback just gets no fan-out candidates."""
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            _list_page_html_artifacts,
        )

        class _RaisingService:
            async def list_artifact_keys(self, **kwargs):
                raise RuntimeError("transport refused")

        ctx = _StubCtx({})
        ctx.artifact_service = _RaisingService()
        keys = await _list_page_html_artifacts(ctx)
        assert keys == []

    async def test_calls_service_with_three_session_kwargs(self):
        """The fix mirrors ``runner._list_artifact_keys`` shape — must
        pass ``session_id``, ``user_id``, ``app_name`` as keyword args
        (the ADK artifact-service contract)."""
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            _list_page_html_artifacts,
        )

        captured: dict = {}

        class _SpyService:
            async def list_artifact_keys(self, **kwargs):
                captured.update(kwargs)
                return ["bundle:html:a.html"]

        ctx = _StubCtx({})
        ctx.artifact_service = _SpyService()
        await _list_page_html_artifacts(ctx)
        assert set(captured) == {"session_id", "user_id", "app_name"}
        assert captured["session_id"] == "s"
        assert captured["user_id"] == "u"
        assert captured["app_name"] == "a"


def test_footer_fallbacks_include_footer_footer() -> None:
    fb = chrome_fallback_selectors("footer")
    assert "footer" in fb
    assert "footer.footer" in fb


def test_sidebar_fallbacks_include_aside() -> None:
    assert "aside" in chrome_fallback_selectors("sidebar")


def test_unknown_role_returns_empty() -> None:
    assert chrome_fallback_selectors("mystery") == ()


def test_table_constant_exposed_for_import() -> None:
    assert isinstance(CHROME_FALLBACK_SELECTORS, dict)
    assert set(CHROME_FALLBACK_SELECTORS) >= {"header", "footer", "sidebar"}


# ---------------------------------------------------------------------------
# Happy path: LLM's declared (source, selector) matches on attempt 1
# ---------------------------------------------------------------------------


class TestHappyPath:
    async def test_declared_source_and_selector_match(self):
        ctx = _StubCtx(
            {
                "bundle:doc:partials.html": KNGNRSSF_PARTIALS,
                "bundle:html:index.html": KNGNRSSF_PAGE_HTML,
            }
        )
        region = _region("header", "bundle:doc:partials.html", "nav.nav")
        result = await extract_chrome_region_with_fallback(ctx, region)
        assert 'class="nav"' in result
        assert "HappyDoods" in result


# ---------------------------------------------------------------------------
# Fallback layer 1: declared source × fallback selector
# ---------------------------------------------------------------------------


class TestSelectorFallback:
    async def test_declared_source_correct_but_selector_wrong(self):
        # LLM thought the nav was `header.topbar`; actual is `nav.nav`.
        # Selector fallback `nav.nav` is in the header role's fallback list.
        ctx = _StubCtx(
            {
                "bundle:doc:partials.html": KNGNRSSF_PARTIALS,
                "bundle:html:index.html": KNGNRSSF_PAGE_HTML,
            }
        )
        region = _region("header", "bundle:doc:partials.html", "header.topbar")
        result = await extract_chrome_region_with_fallback(ctx, region)
        # Fallback `nav.nav` matched the partials nav.
        assert 'class="nav"' in result


# ---------------------------------------------------------------------------
# Fallback layer 2: page bundle × LLM's selector — the kngnrssf case
# ---------------------------------------------------------------------------


class TestSourceFallback:
    async def test_kngnrssf_footer_resolved_from_page(self):
        """Exact reproduction of the kngnrssf failure pattern.

        LLM emitted ``source_artifact: 'bundle:doc:partials.html'`` and
        ``selector: 'footer.footer'``. Partials has only ``<nav>``; the
        ``<footer class="footer">`` lives in every page bundle. The shared
        helper finds it on the first page bundle attempted.
        """
        ctx = _StubCtx(
            {
                "bundle:doc:partials.html": KNGNRSSF_PARTIALS,
                "bundle:html:index.html": KNGNRSSF_PAGE_HTML,
                "bundle:html:shop.html": KNGNRSSF_PAGE_HTML,
                "bundle:html:contact.html": KNGNRSSF_PAGE_HTML,
            }
        )
        region = _region("footer", "bundle:doc:partials.html", "footer.footer")
        result = await extract_chrome_region_with_fallback(ctx, region)
        assert 'class="footer"' in result
        assert "footer-grid" in result
        # Must not include the page's body or header.
        assert "page-header" not in result
        assert "Page body content" not in result

    async def test_declared_source_missing_then_page_fallback(self):
        # Source artifact doesn't exist at all. Helper should still find
        # the chrome in a page bundle.
        ctx = _StubCtx(
            {"bundle:html:index.html": KNGNRSSF_PAGE_HTML}
        )
        region = _region(
            "footer", "bundle:doc:nonexistent.html", "footer.footer"
        )
        result = await extract_chrome_region_with_fallback(ctx, region)
        assert 'class="footer"' in result


# ---------------------------------------------------------------------------
# Fallback layer 3: page bundle × fallback selector
# ---------------------------------------------------------------------------


class TestSourceAndSelectorFallback:
    async def test_page_bundle_with_fallback_selector(self):
        # LLM gave wrong source + wrong selector. Footer exists in a page
        # under the bare `footer` tag (fallback selector).
        page_html = "<body><main>x</main><footer>plain footer</footer></body>"
        ctx = _StubCtx(
            {
                "bundle:doc:partials.html": KNGNRSSF_PARTIALS,
                "bundle:html:home.html": page_html,
            }
        )
        region = _region(
            "footer", "bundle:doc:partials.html", "footer.nonexistent-class"
        )
        result = await extract_chrome_region_with_fallback(ctx, region)
        assert "plain footer" in result


# ---------------------------------------------------------------------------
# Exhausted: every attempt missed → diagnostic HandlerError
# ---------------------------------------------------------------------------


class TestExhaustedFallback:
    async def test_no_match_anywhere_raises(self):
        # No `<footer>` anywhere in the bundle.
        page_html = "<body><main><p>only main content</p></main></body>"
        ctx = _StubCtx(
            {
                "bundle:doc:partials.html": KNGNRSSF_PARTIALS,
                "bundle:html:home.html": page_html,
            }
        )
        region = _region("footer", "bundle:doc:partials.html", "footer.footer")
        with pytest.raises(HandlerError) as excinfo:
            await extract_chrome_region_with_fallback(ctx, region)
        msg = str(excinfo.value)
        # Diagnostic message lists what was tried.
        assert "footer.footer" in msg
        assert "bundle:doc:partials.html" in msg
        # Should report fan-out coverage so the user knows it wasn't a
        # single-attempt failure.
        assert "fallback" in msg.lower()


# ---------------------------------------------------------------------------
# Stitch parity — the same helper handles Stitch's per-page source pattern
# ---------------------------------------------------------------------------


class TestStitchParity:
    async def test_stitch_per_page_source_with_correct_selector(self):
        # Stitch's typical case: per-page bundle as source_artifact;
        # selector matches directly. No fallback needed (happy path).
        stitch_page = (
            "<html><body>"
            '<header class="fixed top-0 sticky">Stitch nav</header>'
            "<main>page</main>"
            "</body></html>"
        )
        ctx = _StubCtx({"bundle:html:home/code.html": stitch_page})
        region = _region(
            "header", "bundle:html:home/code.html", "header.fixed"
        )
        result = await extract_chrome_region_with_fallback(ctx, region)
        assert "Stitch nav" in result
