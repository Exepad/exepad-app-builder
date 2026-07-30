# Contributing to Exepad

Thanks for your interest in improving Exepad! This guide covers local setup,
tests, conventions, and the pull-request flow. For the architecture and monorepo
layout, read [`CLAUDE.md`](CLAUDE.md) and the per-app `apps/*/CLAUDE.md` files
first — they are the source of truth for how the pieces fit together.

## Prerequisites

| Tool | Version |
|------|---------|
| **pnpm** | 9.15 |
| **Node** | 22 |
| **Python** | 3.12 (for the `apps/agent` build agent) |

You also need an **LLM API key** (Google Gemini by default) to exercise app
builds — the studio starts without one, but builds fail until it's set.

## Setup

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Set up the Python agent venv (needed to run the full rig from source)
cd apps/agent && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
cd ../..

# 3. Provide an LLM key
echo "EXEPAD_LLM_API_KEY=your-key-here" > .env
```

## Running locally

```bash
pnpm dev          # runtime SPA (Vite) + runtime worker (tsx watch) via Turbo
./run.sh local    # full stack from source (Node runtime on :8090 + Python agent on :8081)
./run.sh          # build + run the single self-hosted container (docker compose)
```

`./run.sh local` deliberately serves the Node runtime on **:8090** (not :8080)
so it can coexist with a Docker run. Override with `PORT=…`.

## Tests

```bash
pnpm test                                   # all TypeScript tests (Vitest)
pnpm --filter @exepad/runtime-client test   # scope to one package

# Python agent (from apps/agent, venv active):
make test        # all agent tests except eval
make check       # quick dev check (format + lint + unit tests)
```

Please run the relevant test suite before opening a PR, and add tests for new
behavior or bug fixes.

## Code conventions

- **TypeScript strict mode** everywhere; **Zod** for runtime validation.
- **PascalCase** for React components; **camelCase** for functions and variables.
- Component prop types are suffixed with `Props`.
- Radix UI as the unstyled base + Tailwind for styling (shadcn/ui pattern).
- Python (`apps/agent`): Black (line-length 100), Flake8, mypy — run
  `make static` before committing.

## Branch & PR flow

1. Fork the repo (or branch, if you have push access) — **never commit to
   `main` directly**.
2. Create a topic branch: `git checkout -b feat/short-description`.
3. Make focused commits with clear messages.
4. Ensure tests and linters pass locally.
5. Open a pull request against `main`, filling in the PR template. Link any
   related issue and describe what you changed and how you verified it.
6. A maintainer will review; address feedback by pushing follow-up commits.

## License of contributions

Exepad is licensed under **AGPL-3.0** (see [`LICENSE`](LICENSE)). Everything in
this repository is, and will remain, available under AGPL-3.0.

By submitting a contribution you confirm the following.

1. **Your contribution is licensed under AGPL-3.0**, the same terms as the rest
   of the project, to everyone who receives it.

2. **You additionally grant Exepad LLC** a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable licence to reproduce, prepare derivative works of,
   publicly display, publicly perform, sublicense and distribute your
   contribution and such derivative works, **including under licence terms other
   than AGPL-3.0**.

3. **You grant a patent licence** on the same terms: a perpetual, worldwide,
   non-exclusive, royalty-free, irrevocable patent licence to make, use, offer
   to sell, sell, import and otherwise transfer your contribution, covering only
   those patent claims you own or control that are necessarily infringed by your
   contribution alone or by its combination with the project.

4. **You have the right to grant this.** The contribution is your original work,
   or you have the necessary rights in it; and if your employer has rights to
   work you create, you have permission to contribute on their behalf or they
   have waived those rights.

You keep the copyright in your contribution. Point 2 is what lets Exepad LLC
offer the project under a separate commercial licence to organisations whose
policies forbid AGPL software — a common arrangement for AGPL projects (Grafana,
Qt and MongoDB have all used it). Without it, that option would require tracking
down and getting consent from every past contributor. **It does not let anyone
take the project proprietary**: the AGPL-3.0 grant in point 1 is irrevocable, so
this code stays open source permanently.

If you would rather not grant point 2, say so in your pull request — small
fixes are usually easy to accept on AGPL-only terms, and we would rather have
the contribution than not.

## Reporting bugs & security issues

- **Bugs / features:** open a GitHub issue using the templates in
  `.github/ISSUE_TEMPLATE/`.
- **Security vulnerabilities:** do **not** open a public issue — follow
  [`SECURITY.md`](SECURITY.md) instead.
