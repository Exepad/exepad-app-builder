# `component_urls_images` fixer fixtures

Exercises every branch of
[`apply_component_urls_images_fixes`](../../../../../main_agent/services/validation/fixers/component_urls_images.py).

The fixer reads no `FixContext` fields — its only input is the TSX source
— so every case here uses an empty `context: {}`.

## Branch grid

| Branch in fixer (line range) | Broken case(s) | Correct case(s) |
|---|---|---|
| Icon fuzzy-match (462–481) | `broken_icon_typo_close_match`, `broken_icon_unknown_fallback` | `correct_icon_valid` |
| Hallucinated `<img src>` (487–505) | `broken_img_unsplash`, `broken_img_unknown_domain` | `correct_img_allowed_gcs` |
| Array image-property URLs (511–529) | `broken_array_image_blocked` | `correct_array_image_allowed` |
| Static `<img>` in `.map()` (paren-balanced) | `broken_static_img_in_map`, **`broken_static_img_outside_map_left_alone`** (P0 regression — RetailFlux 2026-04-21) | `correct_dynamic_img_in_map` |
| CSS `url()` (543–564) | `broken_style_url_unsplash` | `correct_style_url_allowed_domain` |
| Baked repo-asset URL (572–600) | `broken_baked_repo_asset` | (covered by absence of `/a/.../repo/`) |
| Bare-slug `href:` object property (line 630) | `broken_bare_slug_href_object_property` | `correct_external_link_unchanged` |
| Bare-slug `href=` JSX attr (line 646) | `broken_bare_slug_href_attr` | `correct_external_link_unchanged` |
| Bare-slug `navigate()` (line 661) | `broken_bare_slug_navigate` | `correct_external_link_unchanged` |
| Bare-slug `<Link to>` (line 670) | `broken_bare_slug_link_to` | `correct_external_link_unchanged` |
| Raw `<img>` → `<ExepadImage>` (688–690) | `broken_raw_img_placeholder` | `correct_existing_exepad_image` |
| `<ExepadImage>` props (62–147) | `broken_exepad_image_missing_keywords`, `broken_exepad_image_oversized_dimensions`, `broken_exepad_image_jsx_keywords` | `correct_exepad_image_fully_specified`, `correct_exepad_image_spread_only` (defensive: spread tags must NOT be mutated) |
| **Cross-branch interaction** | `broken_kitchen_sink_multi_branch` (4 branches in one file) | — |

Idempotence is asserted on every case automatically (the harness re-runs
the fixer on its own output).

## Adding a regression case

Drop a new `broken_*.tsx` (and optionally `correct_*.tsx`) under
`examples/`, then append a manifest entry to `cases.json`. See
`../README.md` for the schema.
