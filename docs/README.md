# Exepad Platform Documentation

> **Start here:** for how the shipped product works, read the root [`README.md`](../README.md) / [`CLAUDE.md`](../CLAUDE.md) and then [`docs/latest/`](latest/).

Root documentation index for the `exepad-app-builder` monorepo. Per-app docs live next to the app they describe; this file points at everything.

> **Installing Exepad?** → quickstart: **[INSTALL.md](../INSTALL.md)** (one-liners for macOS/Linux/Windows + optional MSI/zip/tarball packages); full reference: **[docs/install/](install/README.md)** (curl / PowerShell / npx / Docker / from-source, HTTPS, updates, backup, troubleshooting).

## Monorepo map (where docs live)

```
exepad-app-builder/
├── CLAUDE.md                              # Monorepo overview (tech stack, key commands)
├── INSTALL.md                             # Per-platform install quickstart
├── docs/
│   ├── README.md                          # This file
│   ├── install/                           # Install guide (all methods, HTTPS, updates, backup)
│   ├── latest/                            # Current platform-wide architecture docs
│   └── prompt-examples/                   # Test-prompt corpora for agent eval
│
├── apps/
│   ├── agent/                             # Python ADK agent (orchestrator service, internal :8081)
│   │   ├── CLAUDE.md                      # Agent overview
│   │   ├── docs/latest/                   # Numbered agent docs (01-15) + skills.md
│   │   ├── docs/validation/rules.md       # Validator rule + auto-fixer catalog
│   │   ├── main_agent/agents/orchestrator/README.md
│   │   ├── main_agent/agents/orchestrator/app_types/webapp/README.md
│   │   └── tests/                         # TEST_HOWTO.md, fixtures READMEs, eval rubric notes
│   ├── runtime/
│   │   ├── CLAUDE.md                      # Runtime overview
│   │   └── docs/                          # Numbered runtime docs + webapp-props-review
│   └── app-backend/
│       └── docs/latest/                   # App-backend architecture, API, auth, deployment
│
└── packages/
    ├── deploy-utils/                      # Deploy pipeline (esbuild TSX→JS + local SQLite execution)
    ├── design-tools-fixtures/             # Design-import fixtures (claude_design, stitch)
    ├── exepad-cli/                        # Operator CLI (npm package `exepad-app-builder`)
    ├── exepad-sdk/README.md               # SDK build notes
    ├── local-adapters/                    # Local infra shims behind Cloudflare-shaped binding interfaces
    ├── schemas/data/agent_docs/           # Agent-facing prompt docs (planner, builders, surfaces)
    ├── types/                             # Shared TypeScript type definitions
    └── ui-core/                           # Shared Tailwind CSS styles
```

## Platform-wide docs (`docs/latest/`)

| # | Document | Description |
|---|----------|-------------|
| 00 | [General / Architecture Summary](latest/00-general.md) | Platform-level architecture summary |
| 01 | [Platform Overview](latest/01-platform-overview.md) | What Exepad is, core principles |
| 02 | [Architecture](latest/02-architecture.md) | Monorepo layout, tech stack, data flow |
| 03 | [Runtime Engine](latest/03-runtime-engine.md) | DynamicRenderer, component resolution |
| 04 | [Component Catalog](latest/04-component-catalog.md) | Code Focus components + the SDK primitives they import |
| 05 | [State & Actions](latest/05-state-and-actions.md) | Zustand stores + SDK hooks |
| 06 | [Backend System](latest/06-backend-system.md) | App-backend, CRUD, handlers, auth |
| 07 | [Configuration Reference](latest/07-configuration-reference.md) | `WebAppProps` schema |
| 08 | [Styling & Theming](latest/08-styling-and-theming.md) | Theme system, Tailwind v4, auto-contrast |
| 09 | [SDK Reference](latest/09-sdk-reference.md) | Browser SDK hooks and exports |
| 10 | [Deployment](latest/10-deployment.md) | Self-hosted single-container deploy pipeline (Node + local Python agent + SQLite) |
| 11 | [Use Cases](latest/11-use-cases.md) | App types, showcase mapping |
| 12 | [Development Guide](latest/12-development-guide.md) | Local setup, commands, conventions |
| 13 | [Form Design Research](latest/13-form-design-research.md) | Background research informing form components |
| 14 | [Design Imports](latest/14-design-imports.md) | Stitch / Claude Design / Anima upload pipeline — deterministic decomposition + Babel-shell per-module path |

## Per-app quick links

- [Agent — `apps/agent/CLAUDE.md`](../apps/agent/CLAUDE.md) and [`docs/latest/`](../apps/agent/docs/latest/)
- [Validator catalog — `apps/agent/docs/validation/rules.md`](../apps/agent/docs/validation/rules.md) — the rule + auto-fixer reference every generated component is checked against (ground truth)
- [Runtime — `apps/runtime/CLAUDE.md`](../apps/runtime/CLAUDE.md) and [`docs/`](../apps/runtime/docs/)
- [App Backend — `apps/app-backend/docs/latest/`](../apps/app-backend/docs/latest/)
- [Releasing — `RELEASING.md`](../RELEASING.md) — how release artifacts (image, CLI, installers) are cut

## Agent-facing prompt docs

Markdown files under `packages/schemas/data/agent_docs/` are injected into agent prompts at runtime. They are **product docs for the agent**, not end-user docs. Do not rewrite them without updating the corresponding prompt templates in `apps/agent/main_agent/agents/orchestrator/app_types/webapp/prompts/`.
