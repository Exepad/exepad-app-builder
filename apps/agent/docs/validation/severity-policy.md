# Validation Severity Policy

## Why this exists

Validators emit findings at two severities: **error** (blocks save, forces
LLM retry) and **warning** (ships with the artifact). Historically the
allocation was ad-hoc: the icon-hallucination check was a warning even
though unknown ``Icons.X`` references render as ``undefined`` and crash
the page with React error #130. App ``ze1ltmf9`` shipped that crash to
production because the warning let it through.

This policy fixes the severity assignment by class, not by case.

## Definitions

A validation finding is **crash-class** iff its violation can cause:

- **React error #130** ("element type is invalid: got undefined") at
  component mount.
- An **undefined SDK export** lookup at module-eval time
  (``does not provide an export named 'X'``).
- An **unhandled exception** during the first render frame.

Crash-class findings ship the deployed page in a state where end users
see a non-rendering component. They MUST be errors, not warnings.

A finding is **quality-class** iff its violation only affects the rendered
appearance (low contrast, near-invisible backgrounds, missing aria-label,
oversized image dimensions) — the page renders, the user just sees a
degraded result. Quality-class findings ship as warnings.

## Current crash-class findings

| Rule ID | Failure mode | Rescue layers (run before the severity check) |
|---|---|---|
| ``component.refs.unknown_icon`` | ``<Icons.X />`` where ``X`` is not in the curated lucide subset. Renders as ``undefined`` → React #130. | (1) ``component_urls_images.apply_icon_fallback_only`` runs as part of the in-pipeline urls_images fixer. (2) Same helper runs in ``artifact_tools._apply_post_fix_syntax_gate`` Tier B path on the LLM original. (3) ``artifact_tools._apply_unconditional_icon_rescue`` runs in the save tool between the post-fix gate and ``run_semantic_checks``. The elevated error severity is the backstop for edge cases all three rescues miss (bracket access, re-aliased ``Icons``). |

## Adding a new crash-class finding

A new check qualifies as crash-class only if it satisfies the definitions
above. The PR that promotes a check MUST also:

1. **Document the failure mode** — link a real production app or a
   reproduction that exhibits the crash.
2. **Provide an unconditional rescue pass** — a deterministic, regex-only
   (or AST-only) rewrite that is idempotent and structurally incapable of
   introducing new corruption. The rescue runs BEFORE the severity check
   so the saved artifact never carries a crash-class issue in the normal
   path. The error severity only fires when the rescue fails to reach a
   reference (edge case).
3. **Add a regression test** — a TSX fixture exhibiting the crash class;
   assert (a) the rescue scrubs it, (b) the elevated severity catches it
   if the rescue is bypassed, (c) the saved artifact compiles and renders
   without the crash.

Without all three, a check stays at warning severity. Promotion without a
rescue pass would force the LLM to retry on every occurrence — most LLM
retry rounds today are wasted because the model can't reliably correct
the hallucination it just emitted, so adding new error-severity checks
without rescue passes regresses build cost.

## Why warnings can stay warnings

Quality-class findings ship as warnings because:

- The rendered page still works; the user can iterate via the editor flow.
- Forcing retries on cosmetic issues regresses build cost without
  changing correctness — the LLM tends to produce the same near-miss
  twice.
- The auto-fixer pipeline already cleans up many of them deterministically
  (opacity clamping, M3 token pairing, animate-in duration rewrites).

Per-fixer rollback (Change A) ensures these auto-fixes survive even when
neighbouring fixers corrupt — so the warning-severity findings get the
benefit of the fixers' best-effort remediation without the all-or-nothing
risk of the pre-Change-A pipeline.

## AST-first policy for fixers (cross-reference)

Independent of severity, the fixer architecture has its own quality bar:
new fixers that mutate JSX or className expressions MUST use the AST
mutation harness (``services/validation/tsx_ast/mutator.py``, Change H.1).
Regex-on-JSX is structurally unsafe because regex cannot represent
nested JSX expressions, template literals, or comments. Existing
regex-on-JSX fixers are being migrated to AST under Change J. New
fixers violating this require a code-review override.

The AST-first policy and the severity policy are independent layers:
- **Severity policy** decides whether a finding blocks save.
- **AST-first policy** decides how a fixer can mutate the source.

A check can be quality-class and still need an AST-based rescue pass
(if the check's automatic rewrite is non-trivial); a check can be
crash-class and have a regex-only rescue (because ``Icons.PascalCase``
references don't cross JSX boundaries — they're always property access
expressions, never tag names with attributes).
