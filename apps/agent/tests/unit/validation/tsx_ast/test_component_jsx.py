"""Unit tests for JSX-shape component rules."""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_imports import (
    SdkImportCompletenessRule,
)
from main_agent.services.validation.tsx_ast.rules.component_jsx import RawImgTagRule


def _run(rule, tsx: str, **ctx_kwargs):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, **ctx_kwargs)
    return [f.message for f in run_rules(ctx, [rule])]


class TestRawImgTagRule:
    def test_happy_path_exepad_image(self):
        tsx = '<ExepadImage src="https://storage.googleapis.com/x.png"/>'
        assert _run(RawImgTagRule(), tsx) == []

    def test_licensed_img_not_flagged(self):
        # ``<img>`` with a non-placeholder, non-data literal is allowed
        # by this rule (the regex version only warns on bad src values).
        tsx = '<img src="https://storage.googleapis.com/x.png"/>'
        assert _run(RawImgTagRule(), tsx) == []

    def test_dynamic_src_not_flagged(self):
        tsx = "<img src={item.image}/>"
        assert _run(RawImgTagRule(), tsx) == []

    def test_placeholder_src_flagged(self):
        tsx = '<img src="__PLACEHOLDER__"/>'
        findings = _run(RawImgTagRule(), tsx)
        assert len(findings) == 1
        assert "raw <img>" in findings[0]

    def test_data_uri_flagged(self):
        tsx = '<img src="data:image/svg+xml;base64,..."/>'
        findings = _run(RawImgTagRule(), tsx)
        assert len(findings) == 1

    def test_missing_src_flagged(self):
        tsx = "<img alt='x'/>"
        findings = _run(RawImgTagRule(), tsx)
        assert len(findings) == 1


class TestSdkImportCompletenessRule:
    def test_happy_path(self):
        tsx = (
            "import { Button, Dialog, DialogContent } from '@exepad/sdk';\n"
            "const x = <Dialog><DialogContent/></Dialog>;"
        )
        assert _run(SdkImportCompletenessRule(), tsx) == []

    def test_missing_import_flagged(self):
        tsx = (
            "import { Dialog } from '@exepad/sdk';\n" "const x = <Dialog><DialogContent/></Dialog>;"
        )
        findings = _run(SdkImportCompletenessRule(), tsx)
        # DialogContent is an SDK export that's referenced in JSX but not
        # imported.
        assert len(findings) == 1
        assert "<DialogContent>" in findings[0]

    def test_local_component_not_flagged(self):
        # ``MyCard`` isn't in the SDK catalog → presumed local.
        tsx = (
            "import { Button } from '@exepad/sdk';\n"
            "function MyCard() { return null; }\n"
            "const x = <><Button/><MyCard/></>;"
        )
        assert _run(SdkImportCompletenessRule(), tsx) == []

    def test_no_sdk_import_silent(self):
        # No ``@exepad/sdk`` import → another rule will have caught the
        # illegal import policy. This rule does not pile on.
        tsx = "const x = <Dialog/>;"
        assert _run(SdkImportCompletenessRule(), tsx) == []
