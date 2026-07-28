"""R4 regression — ``<ExepadImage keywords={dynamic} />`` inside a `.map()`
must bind ``src=`` from the row OR declare ``vendor="catalog"``.

App ``9vvnqllg`` (chick-farm4017, 2026-05-16): HomeContent "Latest
Products" iterated ``useModel('products')`` and emitted
``<ExepadImage keywords={`Farm fresh ${product.name}`} ... />`` with no
``src=`` and no ``vendor=``. Cards rendered blank skeleton boxes; the
runtime can't resolve dynamic keywords to a deployed asset.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.exepad_image_dynamic_keywords_no_src import (
    ExepadImageDynamicKeywordsNoSrcRule,
)

pytestmark = [pytest.mark.unit]


def _ctx(tsx: str) -> AstContext:
    return AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=parse_tsx(tsx),
    )


def _findings(tsx: str) -> list:
    return list(ExepadImageDynamicKeywordsNoSrcRule().check(_ctx(tsx)))


# ---------------------------------------------------------------------------
# Triggers — dynamic keywords without src or vendor=catalog
# ---------------------------------------------------------------------------


CHICK_FARM_LATEST_PRODUCTS = """
import { React, ExepadImage, useModel } from "@exepad/sdk";
function HomeContent() {
  const { data: products } = useModel('products');
  return (
    <>
      {(products ?? []).map((product) => (
        <ExepadImage
          keywords={`Farm fresh ${product.name} ${product.category}`}
          importance={8}
          className="w-full h-full object-cover"
          width={800}
          height={600}
        />
      ))}
    </>
  );
}
"""


def test_chick_farm_latest_products_flagged() -> None:
    findings = _findings(CHICK_FARM_LATEST_PRODUCTS)
    assert len(findings) == 1
    assert findings[0].severity == "error"
    assert findings[0].rule_id == "component.image.dynamic_keywords_no_src"


def test_dynamic_identifier_keywords_flagged() -> None:
    # `keywords={product.name}` — also dynamic, also bad.
    tsx = """
function X({product}) {
  return <ExepadImage keywords={product.name} width={800} height={600} />;
}
"""
    findings = _findings(tsx)
    assert len(findings) == 1


# ---------------------------------------------------------------------------
# Non-triggers
# ---------------------------------------------------------------------------


def test_dynamic_src_passes() -> None:
    # Per-row src binding is the canonical fix.
    tsx = """
function X({product}) {
  return (
    <ExepadImage
      src={product.image_url}
      keywords={product.name}
      width={800} height={600}
    />
  );
}
"""
    assert _findings(tsx) == []


def test_catalog_vendor_passes() -> None:
    # Explicit catalog vendor is the alternative escape hatch.
    tsx = """
function X({product}) {
  return (
    <ExepadImage
      keywords={product.name}
      vendor="catalog"
      width={800} height={600}
    />
  );
}
"""
    assert _findings(tsx) == []


def test_static_keywords_passes() -> None:
    # Static literal keywords — polish-emitted hero/section images.
    # Resolver hashes the literal and looks up a stable asset.
    tsx = """
function X() {
  return (
    <ExepadImage
      keywords="Happy chickens grazing in a lush green pasture"
      width={800} height={600}
    />
  );
}
"""
    assert _findings(tsx) == []


def test_static_keywords_with_src_passes() -> None:
    # Polish's deployed-asset pattern: src placeholder + static keywords.
    tsx = """
function X() {
  return (
    <ExepadImage
      keywords="Hero image"
      src="__ASSET_IMG:assets/imports/abc.png__"
      width={800} height={600}
    />
  );
}
"""
    assert _findings(tsx) == []


def test_no_exepad_image_no_findings() -> None:
    # Sanity — file has no <ExepadImage>.
    tsx = "function X(){return <div/>;}"
    assert _findings(tsx) == []
