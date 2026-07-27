# Auto-fixer Test Fixtures

Fixture-driven tests for every auto-fixer in
`main_agent/services/validation/fixers/`.

## Layout

```
fixtures/<fixer_module>/
  cases.json        # manifest, parametrized over by the test file
  examples/
    broken_<scenario>.tsx
    correct_<scenario>.tsx
  README.md         # scenario grid for this fixer
```

The harness lives at `../_fixer_harness.py`. Every test file is a thin
wrapper:

```python
from tests.unit.validation._fixer_harness import (
    assert_case, load_cases, make_fix_context, run_fixer,
)
from main_agent.services.validation.fixers.<module> import apply_<module>_fixes

CASES = load_cases("<module>")

@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_<module>_case(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_<module>_fixes, case["tsx"], ctx)
    assert_case(result, case)
```

## Naming

- `broken_<scenario>.tsx` — exercises a fix path. Manifest must declare
  `expected_fix_substrings` and `expected_output_contains` /
  `expected_output_absent`.
- `correct_<scenario>.tsx` — already-correct input. Manifest must mark
  `kind: "correct"`; harness asserts the fixer does not mutate it.

Use snake-case scenario names matching the branch under test, so a grep
of the fixer source points straight at the right file
(e.g. `broken_hallucinated_unsplash_url.tsx` →
`_fix_hallucinated_url` branch in `component_urls_images.py`).

## Manifest schema

| Field | Required | Purpose |
|---|---|---|
| `id` | yes | Unique slug; surfaces as the pytest test id |
| `kind` | yes | `"broken"` or `"correct"` |
| `tsx_path` | yes | Path under the fixture dir, e.g. `examples/broken_x.tsx` |
| `context` | no | Kwargs for `make_fix_context()`. Only the 7 real `FixContext` fields are forwarded; extras are ignored |
| `expected_fix_substrings` | broken | Substrings that must appear in the fixer's `fixes_applied` list |
| `forbidden_fix_substrings` | no | Must NOT appear in `fixes_applied` |
| `expected_output_contains` | broken | Substrings that must appear in the rewritten TSX |
| `expected_output_absent` | no | Substrings that must be gone from the rewritten TSX |
| `expect_no_fixes` | correct | Defaults to `true` for `correct` cases; harness asserts `fixes_applied == []` |
| `expect_idempotent` | no | Defaults to `true`; harness re-runs the fixer on its own output and asserts the OUTPUT does not change |
| `expect_idempotent_fixes` | no | Defaults to `true`; asserts the second pass produces no new fix messages. Set to `false` for warn-only rules (e.g. translation-parity `PARITY VIOLATION`) that describe an unfixable state and re-emit on every pass |
| `source_html_path` | no | Path to a sidecar HTML file (e.g. `source/<scenario>.html`); harness reads it and threads into `FixContext.source_html`. Used by the translation-parity fixer |

`actions` is intentionally absent from `FixContext` (the dispatcher
accepts it but no fixer reads it), so manifests must not include it.

## Adding a regression case

When a prod incident exposes a missed fix path:

1. Drop the offending component into `examples/broken_<incident>.tsx`.
2. Add the fixed version to `examples/correct_<incident>_fixed.tsx`
   (optional — substring assertions are usually enough).
3. Append the case to `cases.json` with the expected fix message and a
   distinguishing output substring.

That's the entire authoring loop. Two files + one manifest entry.

## Authoring gotchas

These bit me writing the first batch of fixtures. Read them before
adding new cases — they save a re-run cycle.

### 1. Doc-comment text leaks into substring assertions

`expected_output_absent: ["<img"]` will match `<img>` literals inside
JSDoc/`/** */` block comments in your fixture file, not just JSX. The
fixer never touches comments, so the assertion fails on text the test
isn't actually about.

**Fix:** use `//` line comments in fixtures, OR rewrite the doc text
to avoid the literal you're forbidding (e.g. `img tag` instead of
`<img>`). When in doubt, anchor the assertion to JSX-only forms like
`<img src` or `<img />` instead of the bare `<img`.

### 2. Negative assertions interact with the *full pipeline*

Every fixer test runs the entire branch list of its target fixer (and
the contrast tests run the whole `apply_auto_fixes` chain). When you
write a fixture to assert "branch X must not fire", surrounding code
must not trigger any *other* branch either, or downstream rewrites
will mutate the substring you were trying to keep.

Example: a "scope-blind regression" fixture for the `.map()` branch
needs an `<img>` outside the map block. If that outer `<img>` uses an
unknown domain, the hallucinated-URL branch rewrites it to
`__PLACEHOLDER__` and the raw-img-to-ExepadImage branch then converts
it. The assertion "outer src is unchanged" fails — but not because of
the bug under test.

**Fix:** for negative-assertion fixtures, use neutral inputs that no
other branch reacts to (allowed image domains, already-leading-slash
paths, valid icon names, etc.). The fixture should isolate exactly
the branch under audit.

### 3. Cross-branch interactions can extend fix messages

When a fixer converts `<img src="__PLACEHOLDER__" alt="...">` to
`<ExepadImage>`, the keyword pipeline then runs against the new tag.
A 3-word alt like `"user portrait headshot"` becomes `keywords="user
portrait headshot with detailed scene and natural lighting"` after
the < 5-word padder fires. Your `expected_output_contains` must match
the *post-padding* form, not the alt verbatim.

**Fix:** when chaining branches in one case, walk through the fixer
in order and pin assertions to the *final* output, not intermediate
states. The kitchen-sink case in `component_urls_images/` is a
worked example.
