---
name: content-artifact
description: "Content artifact loading mode — markdown content rendering, large document search via Vertex AI. Load when the building plan references loading content from a content: artifact or a large document. Keywords: content, markdown, artifact, document, large-document, content-artifact."
metadata:
  kind: domain
---
# Skill: Content Artifact Loading

## Mode 1: Content Artifact Mode
When `content_artifact` is provided in the input:

1. Call `load_artifacts([content_artifact])` to load the markdown content
2. Use the markdown as the SOURCE for all text, headings, stats, testimonials, etc.
3. Use `building_plan` for layout, styling, and interactivity guidance
4. Do NOT rewrite or paraphrase the content — preserve the user's text faithfully
5. Structure the TSX to present the markdown content using proper components

## Mode 2: Large Document Summary Mode
When the planning stage references a large document that was too big to save as a content artifact:

1. Rely on the planner-provided summary and any structured facts it saved into `building_plan`
2. Use that summary as context for layout and emphasis, not as a source for long verbatim passages
3. If the planner did not save enough detail, generate professional placeholder copy instead of inventing precise claims

## When Neither Applies
If `content_artifact` is empty and no large document search is needed, build from scratch using `building_plan` bullets. Generate realistic placeholder content appropriate for the component role. Do NOT call `load_artifacts`.

## Anti-Patterns
- NEVER rewrite or paraphrase content from artifacts — preserve the user's text
- NEVER invent precise claims that were not provided in a content artifact or planning summary
- NEVER call `load_artifacts` when `content_artifact` is empty
