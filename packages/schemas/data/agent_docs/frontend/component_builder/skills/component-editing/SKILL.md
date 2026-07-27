---
name: component-editing
description: "Surgical modification of an existing component TSX. Load when build_mode='edit'. Apply only the changes described in the building_plan; preserve structure, icons, image contract, navigation, and backend hooks outside the explicit plan changes."
metadata:
  kind: flow
---
# Flow Skill — Component Editing (MODE C)

You are modifying an existing TSX component to match the changes described in
`building_plan`. This skill applies when `build_mode == "edit"`.

## Rules

1. **Load the existing source** from `existing_source_artifact` using
   `load_artifacts`. Use the loaded source as your starting point — it is the
   current live component.

2. **Apply ONLY the changes described in `building_plan`.** Preserve all
   existing structure, styling, logic, icons, and functionality that the
   plan does not explicitly mention. The plan is the single source of truth
   for what should change; everything outside that scope stays exactly as it
   is, down to whitespace and attribute ordering where practical.

3. **Do NOT rewrite the component from scratch.** Modify the existing code
   surgically. If the plan says "change the hero heading from X to Y",
   change that one string and leave everything else intact.

4. **Preserve the existing icon system.** If the component uses Material
   Symbols (`<span class="material-symbols-outlined">`), keep them as
   Material Symbols. If it uses Lucide (`<Icons.*/>`), keep them as Lucide.
   Do NOT migrate between systems unless the plan explicitly requests it.

5. **Preserve the existing image contract.** If images use
   `data-asset-relpath`, keep them unchanged (the design-import resolver
   will re-process them). If images use `keywords` for stock lookup, keep
   them that way.

6. **Navigation preservation.** The existing component's nav links are the
   source of truth. Preserve them EXACTLY unless `building_plan` explicitly
   tells you to add, remove, or re-slug a nav item.
   - Do NOT "clean up" links that appear to point to pages missing from
     `app_context.pages`. Those pages may exist in a different config path,
     or may be intentionally provisional — it is not your call to prune them.
   - If `building_plan` is silent about navigation, the `navItems` array
     (or equivalent) MUST be byte-identical to the existing source.
   - Only add a new nav item when `building_plan` says so AND the new slug
     exists in `app_context.pages`.

7. **Backend wiring preservation.** Existing `useModel`, `useHandler`,
   `useApp`, `useCurrentUser`, etc. stays. Only touch these if the plan
   explicitly requests a data source change.

## When in doubt

If the plan is ambiguous about a region, leave that region unchanged. A
smaller, safer diff is always preferable to speculative refactoring.
