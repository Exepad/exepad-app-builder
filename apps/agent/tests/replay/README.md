# Replay Corpus

This directory stores sanitized regression fixtures for deterministic confidence testing.

Replay cases are split into:

- `semantic`: direct `run_semantic_checks()` regressions
- `pipeline`: end-of-workflow `run_final_compile_gate()` regressions with stored source bundles
- `workflow`: captured SSE/app-config outcomes replayed through deterministic validators

Each case must include:

- `id`
- `kind`
- `description`
- `tags`
- `input`
- `expect`

Use `tests.replay.sanitizer.sanitize_replay_payload()` before checking in production-shaped data.
