---
name: scratch-creation
description: "Plan-driven component creation from scratch. Load when build_mode='create' and there is no existing source artifact. Lucide icons only (<Icons.*/>), <ExepadImage> with stock-lookup props, useModel/useHandler drawn from declared backend_surface."
metadata:
  kind: flow
---
# Flow Skill — Scratch Creation (MODE B)

You are building a component from scratch from the `building_plan` bullets and
the app's `design_system_context`. No source HTML was imported; no existing
TSX to preserve. This skill applies when `build_mode == "create"` AND
`source_html_artifact` is empty.

## Rules

1. **`building_plan` is authoritative** for layout, sections, and copy
   direction. Follow it precisely — do not add features, sections, or
   animations not described in the plan.

2. **Generate realistic placeholder content.** Product names, headlines,
   team bios, stats — invent appropriate filler content that fits the app's
   domain. The domain is inferred from `app_context` and the building plan.

3. **Do NOT call `load_artifacts`** unless a domain skill context or
   `content_artifact` field explicitly instructs you to.

4. **Icons — Lucide only (`<Icons.*/>`)** — the platform's default icon
   system. Import `Icons` from `@exepad/sdk`:
   ```tsx
   import { Icons } from "@exepad/sdk";
   <Icons.ArrowRight className="w-5 h-5" />
   ```
   Do NOT use `<span class="material-symbols-outlined">` in this flow.
   Material Symbols is reserved for design imports where the source bundle
   uses it (the mechanical pipeline preserves them verbatim).

5. **Images via `<ExepadImage>` with stock-lookup props.** The build-time
   resolver fetches free-licensed stock photos (Pexels/Pixabay/Unsplash) using
   your `keywords` + `importance` props:
   ```tsx
   <ExepadImage
     keywords="modern office lobby with natural light and glass walls"
     importance={8}
     width={800}
     height={500}
     className="w-full h-64 object-cover rounded-lg"
   />
   ```
   See `11_IMAGES.md` for the full props contract. Do NOT set `src`, `vendor`,
   or `assetId` — those are resolver-owned.

6. **Backend wiring — use the declared surface, don't invent.**
   `backend_surface.models.items` and `backend_surface.handlers.items` are
   closed sets. `useModel('name')` and `useHandler('name')` only accept
   exact names from those lists. If the plan describes a data display but
   the backend surface lacks a matching model, render a static placeholder
   and let the plan stay consistent — never fabricate a model name.

7. **Internal links → `<Link to="/foo">`** from `@exepad/sdk`. Every `to=`
   MUST:
   - **Start with `/`** — it is an absolute-within-app path, not a
     relative one. `<Link to="products">` falls through the SDK's basePath
     prepend and the browser resolves it relative to the current URL
     (from `/products` the click goes to `/products/products` → 404).
     Same rule for `navigate("...")` — always pass a leading-slash path.
   - Resolve to a page slug listed in `app_context.pages`. Do NOT add
     nav items for pages not in that list.

8. **Use the design system tokens** (colors, fonts) consistently. When
   `design_system_context.palette` is present, those `theme.css` token
   values are authoritative — use `bg-primary`, `text-on-surface`, etc.

## Forbidden in this mode

- Inventing model or handler names not in `backend_surface`
- Hardcoded data arrays in place of `useModel`/`useHandler` for dynamic
  lists (static design-token constants are fine)
- Hardcoded date strings older than the current year − 1
- Placeholder `<div>` gray boxes as visual stand-ins — implement the visual
  in CSS/SVG/canvas
- Material Symbols (`<span class="material-symbols-outlined">`) — use
  Lucide instead
