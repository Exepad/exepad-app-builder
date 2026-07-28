## Real TSX Contrast Cases

This fixture corpus stores production-shaped TSX components and matching
`theme.css` files for color contrast validation tests.

Each case in `cases.json` references:

- a real TSX component under `examples/`
- a theme file under `themes/`
- expected warning/fix behavior

The goal is to test contrast behavior with realistic structure:

- `LightDOMContainer`
- nested sections/cards
- semantic theme tokens
- realistic headers, heroes, CTAs, and feature bands

These fixtures are intentionally small, but they should look like something the
agent could actually generate in production.
