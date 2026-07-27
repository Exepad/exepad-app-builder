---
name: theme-token-migration
description: Token-replacement rewrite invoked by the styles-only-coverage escalation. Load only when the workflow flags this in the input. Replaces dropped theme tokens (Material 3 or otherwise) with semantically-equivalent tokens from the new theme.css; preserves layout, behavior, and content.
metadata:
  kind: flow
---
# Flow Skill — Theme Token Migration (MODE C, escalation)

You are rewriting an existing TSX component because the app's theme just
changed and dropped one or more tokens that this component still references.
This skill applies when `build_mode == "edit"` AND the `building_plan`
declares the removed tokens.

The `EditingWorkflow.styles_only_coverage_escalation` path invokes you for
every component flagged by stage-4 style coverage. The workflow has already
run `DesignSystemBuilder` and saved the new `theme.css`; your job is to
update class names so the component compiles cleanly against that theme.

## Rules

1. **Load the existing source** from `existing_source_artifact`. The current
   on-disk TSX is the starting point.

2. **Replace only the dropped-token classes.** `building_plan` lists the
   token names that no longer exist (e.g.
   `tertiary-container, on-secondary-fixed-variant, on-tertiary-container`).
   For each occurrence in the existing source, swap to a
   semantically-equivalent token from the new theme:

   | Removed (Material 3) | Pick from new theme.css |
   |----------------------|-------------------------|
   | `tertiary-container` / `on-tertiary-container` | The accent/highlight surface pair (often `accent` / `accent-foreground` or `secondary` / `secondary-foreground`) |
   | `secondary-fixed-variant` / `on-secondary-fixed-variant` | The neutral/muted surface pair (`muted` / `muted-foreground`) |
   | `surface-container-low` / `on-surface` | Card background (`card` / `card-foreground`) |

   Read the new `theme.css` (already in `design_system_context`) before
   choosing — do not guess. If no semantic match exists, fall back to
   `bg-card text-card-foreground` or `bg-muted text-muted-foreground`.

3. **Do NOT change layout, behavior, content, or imports.** This is a
   token-replacement pass, not a rewrite. Spacing, flex, grid, typography
   utilities, hooks, and JSX structure must stay byte-identical except
   where a class string contains one of the removed tokens.

4. **Preserve contrast pairs.** When you replace `bg-X` you must also
   replace any sibling `text-on-X` / `text-X-foreground` so the foreground
   continues to read against the new background. Don't leave a stale `text-`
   pointing at a token that no longer exists.

5. **Do NOT migrate icon systems** (Material Symbols ↔ Lucide), nav items,
   image contracts, or hooks. Same preservation rules as
   `component-editing` SKILL.md apply.

6. **No new business logic.** If `building_plan` mentions only the removed
   tokens, restrict your changes to className strings. If it mentions other
   changes too, treat them as `component-editing` SKILL.md rules.

## Verification

After your rewrite, the workflow re-runs stage-4 style coverage on the saved
TSX. If any class still references a removed token (or references a token
that does not exist in the new theme), the rewrite is rejected and the
workflow records `StyleCoverageEscalated` in `agent_errors.json`. So:

- Every `bg-*`, `text-*`, `border-*`, `ring-*`, `shadow-*` color class in
  your output must resolve against the current theme.
- Arbitrary classes like `bg-[var(--accent)]` are fine if the variable is
  declared in `@theme`.
- Tokens beyond the explicitly-removed set should remain as-is — do not
  preemptively migrate other Material 3 tokens.
