# TSX validator fixtures

Golden-fixture TSX files consumed by:

- `test_golden_handlers.py` — exercises `handler_rules()` over both
  correct handler TSX (must produce zero errors) and broken handler TSX
  (must fire each rule the fixture was built to exercise).
- `test_golden_components.py` — same contract, but over
  `component_rules()` for component TSX.

## Naming convention

- `correct_<scenario>.tsx` — a valid artifact. The corresponding test
  asserts zero errors across the full rule set. Warnings are tolerated
  (several component / handler rules are advisory).
- `correct_component_<scenario>.tsx` — a correct component (component
  test runner picks this up via the `correct_component_*` glob).
- `broken_<rule_or_cluster>.tsx` — an intentionally invalid artifact.
  The corresponding test asserts that specific rules fire; other rules
  the fixture incidentally triggers are acceptable.

## When to add a new fixture

- A single-rule unit test is usually enough. Only add a fixture when:
  - the scenario requires multiple rules to fire together (rule
    interaction coverage),
  - the scenario is a regression from a real production failure and
    should be pinned, OR
  - the inline TSX string would exceed ~50 lines and obscure the test.
- Add the fixture here, then wire it into the matching `test_golden_*`
  file with a one-line loader call.

## When to remove

- If every rule the fixture was built to exercise now has a focused
  unit test with equal or better coverage, consider deleting the
  fixture and its test to keep the golden suite small.
