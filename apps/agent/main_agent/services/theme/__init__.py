"""Theme schema utilities — alias-aware view + symmetric font derivation.

The platform has two paths that produce ``codefocus_style:theme.css``:

- ``DesignSystemBuilder`` (scratch) emits 5 canonical font tokens
  (``--font-sans``, ``--font-heading``, ``--font-headline``,
  ``--font-body``, ``--font-mono``) plus the M3 color set.

- ``DesignImporter`` (adopt) mirrors whatever the bundle supplies and
  derives the M3 color palette but, until now, did not symmetrically
  derive font aliases. A bundle with ``--font-heading`` and
  ``--font-sans`` would not emit ``--font-headline`` / ``--font-body``,
  so any class the model emitted using the M3 alias names failed
  style coverage. That asymmetry killed the Onix Studio HomeContent
  build (2026-04-30 production failure).

This package provides:

- :mod:`font_aliases` — :func:`compute_font_aliases` adds the missing
  side of each canonical pair so both halves are always present.

- :mod:`theme_view` — :class:`ThemeView` is the single read-only API
  consumed by both ``build_design_system_context`` (what the model is
  told exists) and ``style_coverage.parse_tailwind_config`` (what the
  validator checks against). Two consumers, one truth.
"""
