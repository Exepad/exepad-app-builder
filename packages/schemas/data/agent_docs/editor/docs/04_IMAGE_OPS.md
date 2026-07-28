## IMAGE OPERATIONS — Plan intent, not mechanics

When the user asks to change, swap, or replace an image (background, hero
photo, avatar, product picture, illustration, etc.), your job is to
describe **what** the new image should look like. ComponentBuilder owns
the JSX mechanics — it knows the difference between `<ExepadImage>` props
and which ones to mutate so the rendered image actually changes.

**Rule:** Phrase the `building_plan` as a clear visible-change request.
Do NOT write implementation steps like "remove the src attribute",
"update keywords to ...", or "set alt to ...". Those are ComponentBuilder's
concern.

### How to phrase image-change plans

| User request | Good `building_plan` bullet |
|---|---|
| "Change the background in hero section" | "Replace the hero section's background image with a cinematic sun-drenched organic farm landscape at golden hour with rolling green hills and a rustic barn." |
| "Make the team photo look more modern" | "Replace the team portrait with a modern, candid group photo of professionals in a bright open-plan office." |
| "Swap the avatar with something friendlier" | "Replace the founder's avatar with a warm, smiling portrait in soft natural light." |
| "Update the alt text on the hero for accessibility" | "Update only the alt text on the hero image to '<new alt>'. Leave the image and its keywords unchanged." |

The first three plans tell ComponentBuilder *the new image is different*.
ComponentBuilder will delete the existing `src`, update `keywords` to your
description, and let the platform's image resolver fetch a fresh stock
photo at deploy time.

The fourth plan signals a metadata-only change. ComponentBuilder will
preserve the rendered image and only mutate `alt`.

### Anti-pattern (DO NOT DO THIS)

```json
"building_plan": [
  "Update the ExepadImage keywords to 'fresh farm landscape'.",
  "Update the alt text to 'Farm landscape'."
]
```

This is mechanics, not intent. Worse, it under-specifies the change —
ComponentBuilder cannot tell whether the user wanted the image visibly
swapped or just the metadata updated. Phrase intent clearly so
ComponentBuilder makes the right call:

```json
"building_plan": [
  "Replace the hero section's background image with a fresh, high-end farm landscape (description: golden-hour pasture with rolling hills)."
]
```

### Decision tree summary

```
User wants the rendered image to look different (any visible change)?
  -> ModifyComponentAction whose building_plan says "Replace the X with
     <description of new image>". ComponentBuilder handles the JSX
     mechanics.

User wants only the alt text updated (no visible change)?
  -> ModifyComponentAction whose building_plan says
     "Update only the alt text on X to '<new alt>'. Leave the image and
     its keywords unchanged."
```
